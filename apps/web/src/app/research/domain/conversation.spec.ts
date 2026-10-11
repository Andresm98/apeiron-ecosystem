import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { estimateCalls, groupConversations, toggleParticipant } from './conversation.ts';
import type { RunSummary } from './run-record.ts';

function run(id: string, created_at: string, extra: Partial<RunSummary> = {}): RunSummary {
  return {
    id, created_at, question: `q-${id}`, mode: 'single', simulate: true, status: 'completed',
    usage: { total_tokens: 10 }, model: 'simulation', duration_ms: 1, ...extra,
  };
}

test('agrupa por conversación: título de la primera pregunta y fecha del último intercambio', () => {
  const runs = [
    run('r3', '2026-10-11T12:00:00Z', { conversation_id: 'c1', mode: 'debate', simulate: false }),
    run('r2', '2026-10-11T11:00:00Z'),
    run('r1', '2026-10-11T10:00:00Z', { conversation_id: 'c1' }),
  ];
  const [c1, legacy] = groupConversations(runs);
  assert.equal(c1.id, 'c1');
  assert.equal(c1.title, 'q-r1');
  assert.equal(c1.updated_at, '2026-10-11T12:00:00Z');
  assert.equal(c1.exchanges, 2);
  assert.equal(c1.tokens, 20);
  assert.deepEqual(c1.modes, ['debate', 'single']);
  assert.equal(c1.simulate, false);
  assert.equal(c1.legacy, false);
  assert.equal(legacy.id, 'r2');
  assert.equal(legacy.legacy, true);
});

test('el orden de selección es el orden de palabra y respeta el máximo', () => {
  let table = toggleParticipant([], 'feynman', 3);
  table = toggleParticipant(table, 'epicuro', 3);
  table = toggleParticipant(table, 'nietzsche', 3);
  assert.deepEqual(toggleParticipant(table, 'heraclito', 3), ['feynman', 'epicuro', 'nietzsche']);
  assert.deepEqual(toggleParticipant(table, 'feynman', 3), ['epicuro', 'nietzsche']);
});

test('estimación de llamadas', () => {
  assert.equal(estimateCalls('single', 3, 2), '≈1–2 llamadas');
  assert.equal(estimateCalls('debate', 3, 2), '≈7+ llamadas');
});
