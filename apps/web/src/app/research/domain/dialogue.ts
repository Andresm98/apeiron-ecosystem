import type { AgentStep, Turn } from './chat.ts';

/** Turno al que responde `turns[index]`: la última posición previa de su interlocutor. */
export function repliedTurn(turns: Turn[], index: number): Turn | null {
  const target = turns[index]?.responds_to;
  if (!target) return null;
  for (let i = index - 1; i >= 0; i--) {
    if (turns[i]!.agent === target && !turns[i]!.degraded) return turns[i]!;
  }
  return null;
}

/** Evidencia (pasos con herramienta) que un agente usó para producir su turno. */
export function stepsOfTurn(steps: AgentStep[], turn: Turn): AgentStep[] {
  return steps.filter((s) => s.agent === turn.agent && s.round === turn.round);
}

/** Pasos de agentes que aún no publicaron su turno: lo que se está razonando ahora. */
export function pendingSteps(steps: AgentStep[], turns: Turn[]): AgentStep[] {
  return steps.filter((s) => !turns.some((t) => t.agent === s.agent && t.round === s.round));
}

/** Extracto legible para citar a otro agente. */
export function excerpt(text: string, limit = 180): string {
  const clean = text.replace(/\[simulación\]\s*/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), limit / 2))}…`;
}
