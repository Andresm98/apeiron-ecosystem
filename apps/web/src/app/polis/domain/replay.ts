import type { ChatEvent } from '../../research/domain/chat.ts';
import type { TimelineEvent } from '../../research/domain/run-record.ts';

const REPLAYABLE = new Set(['trace', 'turn', 'node', 'step', 'guard', 'answer', 'session', 'error']);

/** Paso del reproductor: esperar `delay` ms desde el anterior y emitir `event`. */
export interface ReplayStep { delay: number; event: ChatEvent; }

/**
 * Plan de reproducción de una cronología guardada (ADR-013, fase 4). Respeta el orden y el ritmo relativo
 * originales, pero comprime las pausas largas (`maxGap`) para que nadie espere minutos a un LLM ya respondido,
 * y descarta tipos que el cliente no conoce. Las esperas de una sesión no se reproducen como esperas.
 */
export function replayPlan(events: TimelineEvent[], speed = 1, maxGap = 1200): ReplayStep[] {
  const plan: ReplayStep[] = [];
  let previous = events[0]?.t ?? 0;
  for (const item of events) {
    if (!REPLAYABLE.has(item.type)) continue;
    const gap = Math.max(0, item.t - previous);
    previous = item.t;
    const event = { type: item.type, data: item.data } as ChatEvent;
    if (event.type === 'session' && event.data.status === 'waiting') continue; // no hay a quién esperar
    plan.push({ delay: Math.round(Math.min(gap, maxGap) / speed), event });
  }
  return plan;
}

/** Duración total del plan, en ms. */
export function planDuration(plan: ReplayStep[]): number {
  return plan.reduce((total, step) => total + step.delay, 0);
}
