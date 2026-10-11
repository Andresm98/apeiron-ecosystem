import test from 'node:test';
import assert from 'node:assert/strict';
import type { TimelineEvent } from '../../research/domain/run-record.ts';
import { HUMAN, clock, defaultDraft, draftProblem, estimateCalls, reasonLabel, secondsLeft, toRequest } from './deliberation.ts';
import { planDuration, replayPlan } from './replay.ts';

const KNOWN = ['anaximandro', 'heraclito', 'nietzsche', 'feynman', 'epicuro'];

test('draftProblem applies the same rules as the API', () => {
  const draft = defaultDraft(['heraclito', HUMAN]);
  assert.equal(draftProblem(draft, '¿Todo fluye?', KNOWN), null);
  assert.match(draftProblem(draft, '  ', KNOWN) ?? '', /pregunta/);
  assert.match(draftProblem({ ...draft, participants: [] }, 'q', KNOWN) ?? '', /al menos/);
  assert.match(draftProblem({ ...draft, participants: [...KNOWN, HUMAN, 'socrates'] }, 'q', KNOWN) ?? '', /máximo 6/);
  assert.match(draftProblem({ ...draft, participants: ['socrates'] }, 'q', KNOWN) ?? '', /socrates/);
  assert.equal(draftProblem({ ...draft, participants: [...KNOWN, HUMAN] }, 'q', KNOWN), null); // los cinco y tú
  assert.match(draftProblem({ ...draft, budgetMin: 45 }, 'q', KNOWN) ?? '', /tiempo/);
  assert.match(draftProblem({ ...draft, replyMin: 20 }, 'q', KNOWN) ?? '', /respuesta/);
});

test('toRequest translates minutes and rounds into the session body', () => {
  const fixed = toRequest(' q ', { ...defaultDraft(['feynman', HUMAN]), rounds: 2, budgetMin: 3, turnDelayS: 5 }, true);
  assert.deepEqual(fixed, {
    question: 'q', participants: ['feynman', HUMAN], max_rounds: 2, time_budget_s: 180,
    pace: 'auto', turn_delay_s: 5, human_turn_timeout_s: 240, simulate: true,
  });
  const open = toRequest('q', { ...defaultDraft(['epicuro']), openEnded: true, pace: 'step', turnDelayS: 9 }, false);
  assert.equal(open.open_ended, true);
  assert.equal(open.max_rounds, undefined);
  assert.equal(open.turn_delay_s, 0); // en ritmo paso a paso la pausa la decide el usuario
});

test('estimateCalls ignores the human and bounds by the hard cap', () => {
  assert.equal(estimateCalls({ ...defaultDraft(['anaximandro', 'heraclito', HUMAN]), rounds: 2 }, 60), 9);
  assert.equal(estimateCalls({ ...defaultDraft(KNOWN), rounds: 4 }, 30), 30);
  assert.equal(estimateCalls({ ...defaultDraft(KNOWN), openEnded: true }, 60), null);
});

test('countdown helpers', () => {
  assert.equal(secondsLeft(1000, 760_400), 240);
  assert.equal(secondsLeft(1000, 2_000_000), 0);
  assert.equal(secondsLeft(null, 0), null);
  assert.equal(clock(239), '3:59');
  assert.equal(reasonLabel('time_budget'), 'se agotó el tiempo');
  assert.equal(reasonLabel(null), '');
});

test('replayPlan keeps order, compresses long pauses and skips waits and unknown types', () => {
  const events: TimelineEvent[] = [
    { t: 0, type: 'node', data: { node: 'apeiron_router', status: 'start', error: false } },
    { t: 300, type: 'turn', data: { agent: 'heraclito', round: 0, text: 'a' } },
    { t: 90_300, type: 'session', data: { status: 'waiting', waiting: 'human_turn' } },
    { t: 95_000, type: 'turn', data: { agent: 'human', round: 0, text: 'b' } },
    { t: 95_100, type: 'telemetry', data: {} },
    { t: 96_000, type: 'answer', data: { answer: 'síntesis', mode: 'debate' } },
  ];
  const plan = replayPlan(events);
  assert.deepEqual(plan.map((s) => s.event.type), ['node', 'turn', 'turn', 'answer']);
  assert.deepEqual(plan.map((s) => s.delay), [0, 300, 1200, 1000]);
  assert.equal(planDuration(replayPlan(events, 2)), 1250);
  assert.deepEqual(replayPlan([]), []);
});
