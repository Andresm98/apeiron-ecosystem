/** Deliberación de la Polis (ADR-013, fase 2): lo que el usuario configura al convocar en el ágora. */

export const HUMAN = 'human';
export const MAX_PARTICIPANTS = 6;

export type Pace = 'auto' | 'step';

/** Formulario de la tribuna. Los tiempos van en minutos porque así los piensa el usuario. */
export interface DeliberationDraft {
  participants: string[];
  rounds: number; // 1..4; se ignora si el debate es abierto
  openEnded: boolean;
  /** Presupuesto de tiempo en minutos; null = sin límite propio (mandan las rondas o el tope duro). */
  budgetMin: number | null;
  pace: Pace;
  /** Pausa de lectura entre turnos en ritmo automático, en segundos. */
  turnDelayS: number;
  /** Tiempo para escribir el turno de ssanax, en minutos. */
  replyMin: number;
}

/** Cuerpo de `POST /v1/sessions`. */
export interface DeliberationRequest {
  question: string;
  participants: string[];
  max_rounds?: number;
  open_ended?: boolean;
  time_budget_s?: number;
  pace: Pace;
  turn_delay_s: number;
  human_turn_timeout_s: number;
  simulate: boolean;
}

export function defaultDraft(participants: string[]): DeliberationDraft {
  return { participants, rounds: 1, openEnded: false, budgetMin: null, pace: 'auto', turnDelayS: 0, replyMin: 4 };
}

/** Primer problema del formulario, o null si se puede convocar. Mismas reglas que valida la API. */
export function draftProblem(draft: DeliberationDraft, question: string, known: string[]): string | null {
  if (!question.trim()) return 'Escribe la pregunta del debate.';
  if (question.length > 4000) return 'La pregunta no puede superar 4000 caracteres.';
  if (!draft.participants.length) return 'Convoca al menos a un participante.';
  if (draft.participants.length > MAX_PARTICIPANTS) return `Como máximo ${MAX_PARTICIPANTS} participantes.`;
  const unknown = draft.participants.filter((p) => p !== HUMAN && !known.includes(p));
  if (unknown.length) return `No viven en la polis: ${unknown.join(', ')}.`;
  if (!draft.openEnded && (draft.rounds < 1 || draft.rounds > 4)) return 'Las rondas van de 1 a 4.';
  if (draft.budgetMin !== null && (draft.budgetMin < 1 || draft.budgetMin > 30)) return 'El tiempo va de 1 a 30 minutos.';
  if (draft.replyMin < 0.5 || draft.replyMin > 10) return 'Tu tiempo de respuesta va de 0,5 a 10 minutos.';
  if (draft.turnDelayS < 0 || draft.turnDelayS > 30) return 'La pausa entre turnos va de 0 a 30 segundos.';
  return null;
}

export function toRequest(question: string, draft: DeliberationDraft, simulate: boolean): DeliberationRequest {
  return {
    question: question.trim(),
    participants: [...draft.participants],
    ...(draft.openEnded ? { open_ended: true } : { max_rounds: draft.rounds }),
    ...(draft.budgetMin !== null ? { time_budget_s: Math.round(draft.budgetMin * 60) } : {}),
    pace: draft.pace,
    turn_delay_s: draft.pace === 'auto' ? draft.turnDelayS : 0,
    human_turn_timeout_s: Math.round(draft.replyMin * 60),
    simulate,
  };
}

/**
 * Llamadas LLM previstas: cada agente ≈ 2 por turno (consulta + respuesta) y 1 de síntesis. ssanax no gasta.
 * Un debate abierto no tiene previsión: lo acota el tope duro de la sesión.
 */
export function estimateCalls(draft: DeliberationDraft, maxCalls: number): number | null {
  if (draft.openEnded) return null;
  const agents = draft.participants.filter((p) => p !== HUMAN).length;
  return Math.min(agents * draft.rounds * 2 + 1, maxCalls);
}

/** Segundos que quedan hasta `deadline` (epoch en s), nunca negativos. */
export function secondsLeft(deadline: number | null, nowMs: number): number | null {
  return deadline === null ? null : Math.max(0, Math.ceil(deadline - nowMs / 1000));
}

export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

const REASONS: Record<string, string> = {
  closed_by_user: 'cerrada por ti',
  time_budget: 'se agotó el tiempo',
  max_duration: 'tope de duración',
  max_calls: 'tope de llamadas',
  cancelled_by_user: 'cancelada',
  internal_error: 'error interno',
};

export function reasonLabel(reason: string | null): string {
  return reason ? (REASONS[reason] ?? reason) : '';
}
