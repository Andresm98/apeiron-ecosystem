import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunSummary } from '../../research/domain/run-record.ts';
import {
  barWidth, formatUptime, guardrailCounts, historyStats, overallHealth, taskStateLabel,
  type SystemComponent,
} from './system-status.ts';

const component = (status: SystemComponent['status']): SystemComponent => ({ id: status, label: status, status, detail: '' });

test('overall health is the worst active component; disabled or simulated do not count', () => {
  assert.equal(overallHealth([component('ok'), component('disabled'), component('simulated')]), 'ok');
  assert.equal(overallHealth([component('ok'), component('degraded')]), 'degraded');
  assert.equal(overallHealth([component('degraded'), component('down')]), 'down');
});

test('labels and uptime read naturally', () => {
  assert.equal(taskStateLabel('TASK_STATE_REJECTED'), 'Rechazada');
  assert.equal(taskStateLabel('TASK_STATE_NUEVO'), 'TASK_STATE_NUEVO');
  assert.equal(formatUptime(42), '42 s');
  assert.equal(formatUptime(3 * 3600 + 5 * 60), '3 h 5 min');
  assert.equal(formatUptime(3 * 86400 + 2 * 3600), '3 d 2 h');
});

test('guardrail counters are split by stage and sorted', () => {
  assert.deepEqual(guardrailCounts({ 'turn:pii': 1, 'input:prompt_injection': 3 }), [
    { stage: 'input', rule: 'prompt_injection', count: 3 },
    { stage: 'turn', rule: 'pii', count: 1 },
  ]);
  assert.equal(barWidth(0, 0), 0);
  assert.equal(barWidth(1, 100), 4); // mínimo visible
  assert.equal(barWidth(50, 100), 50);
});

test('history stats summarize own runs', () => {
  const base: RunSummary = {
    id: '1', created_at: '', question: 'q', mode: 'single', simulate: false, status: 'completed',
    usage: { total_tokens: 100 }, model: 'm', duration_ms: 1000, channel: 'web',
  };
  const stats = historyStats([
    base,
    { ...base, id: '2', status: 'blocked', usage: {}, duration_ms: 0, channel: 'a2a',
      guardrails: [{ stage: 'input', action: 'block', rules: ['prompt_injection'], agent: 'apeiron', round: 0 }] },
    { ...base, id: '3', status: 'error', simulate: true, duration_ms: 3000 },
  ]);
  assert.deepEqual(
    { ...stats, guardrails: undefined },
    { total: 3, completed: 1, blocked: 1, errors: 1, simulated: 1, a2a: 1, tokens: 200, avgDurationMs: 2000, guardrails: undefined },
  );
  assert.deepEqual(stats.guardrails, [{ rule: 'prompt_injection', count: 1 }]);
});
