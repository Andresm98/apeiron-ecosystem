import type { AgentStep, ChatEvent, GuardEvent, Turn, Usage } from '../domain/chat.ts';
import { type GraphRun, applyNodeEvent, emptyRun } from '../domain/graph-run.ts';
import type { RunRecord } from '../domain/run-record.ts';

export type RunStatus = 'idle' | 'running' | 'done' | 'error';

/** Estado de una ejecución, derivado solo de los eventos del stream. */
export interface RunState {
  status: RunStatus;
  trace: string[];
  turns: Turn[];
  steps: AgentStep[];
  answer: string;
  error: string | null;
  graph: GraphRun;
  usage: Usage | null;
  /** Intervenciones de guardrails (ADR-011) y si la entrada fue rechazada. */
  guards: GuardEvent[];
  blocked: boolean;
}

export function idleRun(): RunState {
  return {
    status: 'idle', trace: [], turns: [], steps: [], answer: '', error: null, graph: emptyRun(), usage: null,
    guards: [], blocked: false,
  };
}

export function startRun(): RunState {
  return { ...idleRun(), status: 'running' };
}

export function reduceRunEvent(state: RunState, ev: ChatEvent): RunState {
  switch (ev.type) {
    case 'trace':
      return { ...state, trace: [...state.trace, ...ev.data.messages] };
    case 'turn':
      return { ...state, turns: [...state.turns, ev.data] };
    case 'node':
      return { ...state, graph: applyNodeEvent(state.graph, ev.data) };
    case 'step':
      return { ...state, steps: [...state.steps, ev.data] };
    case 'guard':
      return { ...state, guards: [...state.guards, ev.data] };
    case 'answer':
      return {
        ...state, status: 'done', answer: ev.data.answer, usage: ev.data.usage ?? null, blocked: !!ev.data.blocked,
      };
    case 'error':
      return failRun(state, `Fallo interno del agente (trace ${ev.data.trace_id ?? '-'}).`);
    default:
      return state; // eventos futuros del contrato: se ignoran sin romper la consola
  }
}

export function failRun(state: RunState, message: string): RunState {
  return { ...state, status: 'error', error: message };
}

/** Cancelar conserva lo recibido hasta el momento. */
export function cancelRun(state: RunState): RunState {
  return state.status === 'running' ? { ...state, status: 'idle' } : state;
}

/** Reabre una ejecución persistida: turnos, traza, respuesta y consumo (sin grafo en vivo). */
export function fromRecord(record: RunRecord): RunState {
  const usage = record.usage.calls === undefined ? null : {
    calls: record.usage.calls ?? 0,
    input_tokens: record.usage.input_tokens ?? 0,
    output_tokens: record.usage.output_tokens ?? 0,
    total_tokens: record.usage.total_tokens ?? 0,
  };
  return {
    ...idleRun(),
    status: record.status === 'error' ? 'error' : 'done',
    trace: record.trace,
    turns: record.turns,
    steps: record.steps ?? [],
    answer: record.answer,
    usage,
    guards: record.guardrails ?? [],
    blocked: record.status === 'blocked',
    error: record.status === 'error' ? `La ejecución falló (${record.error ?? 'error'}; trace ${record.trace_id}).` : null,
  };
}
