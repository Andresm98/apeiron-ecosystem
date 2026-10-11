import type { Mode } from './chat.ts';
import type { RunSummary } from './run-record.ts';

/** Una conversación de la consola en la lista lateral (ADR-014): se deriva de las ejecuciones guardadas. */
export interface ConversationSummary {
  /** `conversation_id`; las ejecuciones antiguas sin él son conversaciones de un solo intercambio. */
  id: string;
  /** true si es una ejecución suelta (sin `conversation_id`): se reabre por su id de ejecución. */
  legacy: boolean;
  title: string;
  updated_at: string;
  exchanges: number;
  modes: Mode[];
  simulate: boolean;
  status: RunSummary['status'];
  channel: RunSummary['channel'];
  tokens: number;
}

/**
 * Agrupa el historial (más reciente primero) en conversaciones: el título es la primera pregunta y la fecha
 * la del último intercambio. Las deliberaciones de la Polis y las tareas A2A quedan como ejecuciones sueltas.
 */
export function groupConversations(runs: readonly RunSummary[]): ConversationSummary[] {
  const byId = new Map<string, ConversationSummary & { first: string }>();
  for (const run of runs) {
    const id = run.conversation_id || run.id;
    const mode: Mode = run.mode === 'debate' ? 'debate' : 'single';
    const known = byId.get(id);
    if (!known) {
      byId.set(id, {
        id, legacy: !run.conversation_id, title: run.question, first: run.created_at, updated_at: run.created_at,
        exchanges: 1, modes: [mode], simulate: run.simulate, status: run.status, channel: run.channel,
        tokens: run.usage.total_tokens ?? 0,
      });
      continue;
    }
    known.exchanges++;
    known.tokens += run.usage.total_tokens ?? 0;
    known.simulate &&= run.simulate;
    if (!known.modes.includes(mode)) known.modes.push(mode);
    if (run.created_at < known.first) {
      known.first = run.created_at; // el título es la pregunta que abrió la conversación
      known.title = run.question;
    }
    if (run.created_at > known.updated_at) known.updated_at = run.created_at;
  }
  return [...byId.values()]
    .map(({ first: _first, ...summary }) => summary)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}

/** Añade o quita un participante de la mesa; el orden de selección es el orden de palabra. */
export function toggleParticipant(table: readonly string[], name: string, max: number): string[] {
  if (table.includes(name)) return table.filter((n) => n !== name);
  return table.length >= max ? [...table] : [...table, name];
}

/** Llamadas LLM aproximadas antes de enviar (orientativo; ReAct puede añadir pasos). */
export function estimateCalls(mode: Mode, participants: number, rounds: number): string {
  if (mode === 'single') return '≈1–2 llamadas';
  return `≈${participants * rounds + 1}+ llamadas`;
}
