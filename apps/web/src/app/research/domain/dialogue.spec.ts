import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentStep, Turn } from './chat.ts';
import { excerpt, pendingSteps, repliedTurn, stepsOfTurn } from './dialogue.ts';

const turns: Turn[] = [
  { agent: 'anaximandro', round: 0, text: 'tesis A', responds_to: null },
  { agent: 'heraclito', round: 0, text: 'réplica H', responds_to: 'anaximandro' },
  { agent: 'anaximandro', round: 1, text: 'contra-réplica A', responds_to: 'heraclito' },
];
const step = (agent: string, round: number): AgentStep => ({
  agent, round, step: 1, tool: 'vector_memory_retriever', input: 'q', observation: 'obs', error: false,
});

test('repliedTurn finds the interlocutor position each turn answers', () => {
  assert.equal(repliedTurn(turns, 0), null);
  assert.equal(repliedTurn(turns, 1)?.text, 'tesis A');
  assert.equal(repliedTurn(turns, 2)?.text, 'réplica H');
});

test('stepsOfTurn and pendingSteps split evidence by agent and round', () => {
  const steps = [step('anaximandro', 0), step('heraclito', 0), step('heraclito', 1)];
  assert.equal(stepsOfTurn(steps, turns[1]!).length, 1);
  assert.deepEqual(pendingSteps(steps, turns).map((s) => `${s.agent}:${s.round}`), ['heraclito:1']);
});

test('excerpt strips the simulation tag and cuts on a word boundary', () => {
  assert.equal(excerpt('[simulación] hola mundo'), 'hola mundo');
  const long = excerpt('palabra '.repeat(40), 30);
  assert.ok(long.endsWith('…') && long.length <= 30);
});
