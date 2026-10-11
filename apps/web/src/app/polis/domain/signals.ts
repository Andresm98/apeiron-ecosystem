import type { RunView } from './citizen-state.ts';

/**
 * Señal visible en la Polis. Cada tipo sale de un dato distinto (ADR-013): no se confunden flujo de control,
 * comunicación entre agentes y uso de herramientas.
 */
export type PolisSignal =
  /** El supervisor cede la palabra (`GraphRun.edges`): pulso desde el centro del ágora. */
  | { kind: 'control'; to: string }
  /** Alguien habla (`turn`): bocadillo sobre su figura con un extracto (ADR-013 §5.6). */
  | { kind: 'speech'; agent: string; text: string }
  /** Un turno replica a otro agente (`turn.responds_to`): haz entre ambos. */
  | { kind: 'reply'; from: string; to: string }
  /** Un paso ReAct usa una herramienta (`step.tool`): mensajero hacia su edificio. */
  | { kind: 'tool'; agent: string; tool: string; error: boolean }
  /** Un guardrail intervino (`guard`): destello sin texto. */
  | { kind: 'guard'; agent: string };

/** Cuántos elementos de cada lista ya se convirtieron en señales. */
export interface SignalCursor { edges: number; turns: number; steps: number; guards: number; }

export const EMPTY_CURSOR: SignalCursor = { edges: 0, turns: 0, steps: 0, guards: 0 };

/**
 * Lee las señales nuevas comparando longitudes: las listas de la ejecución solo crecen, así que una señal no se
 * pierde aunque Angular agrupe varios eventos en el mismo ciclo. Si las listas encogen, empezó otra ejecución y
 * se lee desde el principio. Solo anima lo observado en vivo: no es un replay.
 */
export function readSignals(run: RunView, cursor: SignalCursor): { cursor: SignalCursor; signals: PolisSignal[] } {
  const restarted =
    run.graph.edges.length < cursor.edges || run.turns.length < cursor.turns ||
    run.steps.length < cursor.steps || run.guards.length < cursor.guards;
  const from = restarted ? EMPTY_CURSOR : cursor;
  const signals: PolisSignal[] = [];

  for (const edge of run.graph.edges.slice(from.edges)) {
    const [source = '', to = ''] = edge.split('>');
    if (to.startsWith('apeiron_') || to.startsWith('__')) continue; // movimientos internos de Ápeiron
    if (source === 'apeiron_router' || source === 'apeiron_supervisor') signals.push({ kind: 'control', to });
  }
  for (const turn of run.turns.slice(from.turns)) {
    if (turn.text.trim()) signals.push({ kind: 'speech', agent: turn.agent, text: turn.text });
    if (turn.responds_to && turn.responds_to !== turn.agent) {
      signals.push({ kind: 'reply', from: turn.agent, to: turn.responds_to });
    }
  }
  for (const step of run.steps.slice(from.steps)) {
    signals.push({ kind: 'tool', agent: step.agent, tool: step.tool, error: step.error });
  }
  for (const guard of run.guards.slice(from.guards)) {
    signals.push({ kind: 'guard', agent: guard.agent });
  }
  return {
    cursor: { edges: run.graph.edges.length, turns: run.turns.length, steps: run.steps.length, guards: run.guards.length },
    signals,
  };
}
