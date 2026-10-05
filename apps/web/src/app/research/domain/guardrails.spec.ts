import test from 'node:test';
import assert from 'node:assert/strict';
import { countRules, describeGuard, ruleLabel } from './guardrails.ts';

test('guardrail events read as plain language', () => {
  const ev = { stage: 'turn', action: 'redact', rules: ['ungrounded_citation', 'pii'], agent: 'heraclito', round: 1 } as const;
  assert.equal(describeGuard(ev), 'Turno · saneado · Cita sin respaldo, Dato personal retirado');
  assert.equal(ruleLabel('regla_nueva'), 'regla_nueva');
});

test('rules are counted from most to least frequent', () => {
  const base = { stage: 'observation', action: 'redact', agent: 'a', round: 0 } as const;
  assert.deepEqual(countRules([{ ...base, rules: ['pii'] }, { ...base, rules: ['pii', 'secret'] }]), [
    { rule: 'pii', count: 2 },
    { rule: 'secret', count: 1 },
  ]);
});
