import type { GuardEvent } from './chat.ts';

/** Nombre legible de cada regla de guardrail (ADR-011). */
export const GUARDRAIL_RULES: Record<string, string> = {
  prompt_injection: 'Inyección de instrucciones',
  role_spoofing: 'Suplantación de rol',
  protocol_spoofing: 'Protocolo ReAct falsificado',
  secret: 'Secreto retirado',
  pii: 'Dato personal retirado',
  oversized: 'Observación truncada',
  reasoning_leak: 'Razonamiento privado retirado',
  ungrounded_citation: 'Cita sin respaldo',
  unsupported_evidence: 'Evidencia no consultada',
  guardrail_unavailable: 'Guardrail no disponible',
};

export const GUARDRAIL_STAGES: Record<GuardEvent['stage'], string> = {
  input: 'Entrada',
  observation: 'Observación',
  turn: 'Turno',
  output: 'Síntesis',
};

export function ruleLabel(rule: string): string {
  return GUARDRAIL_RULES[rule] ?? rule;
}

/** "Entrada · bloqueo · Inyección de instrucciones" */
export function describeGuard(ev: GuardEvent): string {
  const action = ev.action === 'block' ? 'bloqueo' : 'saneado';
  return `${GUARDRAIL_STAGES[ev.stage] ?? ev.stage} · ${action} · ${ev.rules.map(ruleLabel).join(', ')}`;
}

/** Conteo por regla, de más a menos frecuente. */
export function countRules(events: GuardEvent[]): { rule: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const ev of events) for (const rule of ev.rules) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  return [...counts].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count);
}
