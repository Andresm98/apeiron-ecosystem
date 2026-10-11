import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatEvent } from '../domain/chat.ts';
import type { RunRecord } from '../domain/run-record.ts';
import { cancelRun, failRun, fromRecord, idleRun, reduceRunEvent, startRun } from './run-state.ts';

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

test('cancelRun keeps received data, marks the run cancelled and settles active nodes', () => {
  const running = replay([
    { type: 'node', data: { node: 'heraclito', status: 'start', error: false } },
    { type: 'node', data: { node: 'heraclito/act', status: 'start', error: false } },
    { type: 'turn', data: { agent: 'heraclito', round: 0, text: 'x' } },
  ]);
  const cancelled = cancelRun(running);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.turns.length, 1);
  assert.deepEqual(cancelled.graph.status, { heraclito: 'idle', 'heraclito/act': 'idle' });
  assert.equal(cancelRun(idleRun()).status, 'idle');
});

test('failures distinguish server errors from lost connections and never leave nodes active', () => {
  const running = replay([{ type: 'node', data: { node: 'anaximandro', status: 'start', error: false } }]);
  const server = reduceRunEvent(running, { type: 'error', data: { message: 'internal_error', trace_id: 't' } });
  assert.equal(server.failure, 'server');
  assert.equal(server.graph.status['anaximandro'], 'error');
  const network = failRun(running, 'Failed to fetch');
  assert.equal(network.status, 'error');
  assert.equal(network.failure, 'network');
  assert.equal(network.graph.status['anaximandro'], 'error');
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

test('session events keep the latest snapshot and a server-side cancel settles the run', () => {
  const snapshot = {
    id: 's1', status: 'waiting', waiting: 'human_turn', deadline: 1_900_000_000, responds_to: 'heraclito',
    participants: ['heraclito', 'human'], reason: null, last_event: 9,
  } as const;
  let state = replay([{ type: 'node', data: { node: 'heraclito', status: 'start', error: false } }]);
  state = reduceRunEvent(state, { type: 'session', data: snapshot });
  assert.equal(state.status, 'running');
  assert.equal(state.session?.waiting, 'human_turn');
  state = reduceRunEvent(state, { type: 'session', data: { ...snapshot, status: 'cancelled', waiting: null, reason: 'cancelled_by_user' } });
  assert.equal(state.status, 'cancelled');
  assert.equal(state.graph.status['heraclito'], 'idle');
  assert.equal(state.session?.reason, 'cancelled_by_user');
});
