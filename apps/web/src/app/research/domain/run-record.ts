import type { AgentStep, Turn, Usage } from './chat.ts';

/** Resumen de una ejecución persistida (lista del historial). */
export interface RunSummary {
  id: string;
  created_at: string;
  question: string;
  mode: string;
  simulate: boolean;
  status: 'completed' | 'error';
  usage: Partial<Usage>;
  model: string;
  duration_ms: number;
}

/** Agente (orquestador o worker) que actuó en una ejecución, con su esfuerzo. */
export interface AgentExecution {
  agent_id: string;
  invocations: number;
  reasoning_steps: number;
  tool_calls: number;
  tools_used: string[];
  degraded: boolean;
  duration_ms: number;
}

/** Ejecución completa: lo necesario para reabrirla en la consola. */
export interface RunRecord extends RunSummary {
  trace_id: string;
  answer: string;
  turns: Turn[];
  trace: string[];
  steps?: AgentStep[];
  agent_executions?: AgentExecution[];
  error: string | null;
}
