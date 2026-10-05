import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatEvent } from '../domain/chat.ts';
import type { RunRecord } from '../domain/run-record.ts';
import { cancelRun, fromRecord, idleRun, reduceRunEvent, startRun } from './run-state.ts';

const replay = (events: ChatEvent[]) => events.reduce(reduceRunEvent, startRun());

test('reduceRunEvent processes stream events in order', () => {
  const state = replay([
    { type: 'trace', data: { messages: ['[Ápeiron Routing]'] } },
    { type: 'node', data: { node: 'anaximandro', status: 'start', error: false } },
    { type: 'turn', data: { agent: 'anaximandro', round: 0, text: 'respuesta' } },
    { type: 'answer', data: { answer: 'Síntesis final', mode: 'single', usage: { calls: 1, input_tokens: 2, output_tokens: 3, total_tokens: 5 } } },
  ]);

  assert.equal(state.status, 'done');
  assert.deepEqual(state.trace, ['[Ápeiron Routing]']);
  assert.equal(state.turns.length, 1);
  assert.equal(state.graph.current, 'anaximandro');
  assert.equal(state.answer, 'Síntesis final');
  assert.equal(state.usage?.total_tokens, 5);
});

test('reduceRunEvent turns error events into a failed run with trace id', () => {
  const state = replay([{ type: 'error', data: { message: 'boom', trace_id: 'abc' } }]);
  assert.equal(state.status, 'error');
  assert.match(state.error ?? '', /abc/);
});

test('cancelRun keeps received data and only stops a running run', () => {
  const running = replay([{ type: 'turn', data: { agent: 'heraclito', round: 0, text: 'x' } }]);
  const cancelled = cancelRun(running);
  assert.equal(cancelled.status, 'idle');
  assert.equal(cancelled.turns.length, 1);
  assert.equal(cancelRun(idleRun()).status, 'idle');
});

test('fromRecord reopens a persisted run without live graph', () => {
  const record: RunRecord = {
    id: 'r1', created_at: '2026-10-04T12:00:00Z', question: 'q', mode: 'debate', simulate: false,
    status: 'completed', usage: { calls: 3, input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    model: 'openai:gpt', duration_ms: 1200, trace_id: 't', answer: 'síntesis',
    turns: [{ agent: 'anaximandro', round: 0, text: 'a' }], trace: ['[Synthesis]'], error: null,
  };
  const state = fromRecord(record);
  assert.equal(state.status, 'done');
  assert.equal(state.answer, 'síntesis');
  assert.equal(state.usage?.total_tokens, 15);
  assert.deepEqual(state.graph.edges, []);
  const failed = fromRecord({ ...record, status: 'error', error: 'RuntimeError' });
  assert.equal(failed.status, 'error');
  assert.match(failed.error ?? '', /RuntimeError/);
  const blocked = fromRecord({ ...record, status: 'blocked', answer: 'Ápeiron no procesó la pregunta' });
  assert.equal(blocked.status, 'done'); // se reabre con su respuesta de rechazo, no como fallo
  assert.equal(blocked.error, null);
});

test('guard events accumulate and a blocked answer is flagged', () => {
  let state = startRun();
  const guard = { stage: 'input', action: 'block', rules: ['prompt_injection'], agent: 'apeiron', round: 0 } as const;
  state = reduceRunEvent(state, { type: 'guard', data: guard });
  state = reduceRunEvent(state, { type: 'answer', data: { answer: 'rechazada', mode: 'single', blocked: true } });
  assert.deepEqual(state.guards, [guard]);
  assert.equal(state.blocked, true);
  assert.equal(state.status, 'done');
});

test('unknown events from a newer API are ignored', () => {
  const state = startRun();
  const next = reduceRunEvent(state, { type: 'future', data: {} } as unknown as Parameters<typeof reduceRunEvent>[1]);
  assert.equal(next, state);
});
