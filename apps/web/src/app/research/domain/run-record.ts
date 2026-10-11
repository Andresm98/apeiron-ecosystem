import type { AgentStep, GuardEvent, Turn, Usage } from './chat.ts';

/** Evento público de la cronología guardada (ADR-013, fase 4): instante relativo en ms, tipo y datos. */
export interface TimelineEvent { t: number; type: string; data: unknown; }

/** Resumen de una ejecución persistida (lista del historial). */
export interface RunSummary {
  id: string;
  created_at: string;
  question: string;
  mode: string;
  simulate: boolean;
  status: 'completed' | 'blocked' | 'error'; // blocked: el guardrail de entrada rechazó la pregunta (ADR-011)
  usage: Partial<Usage>;
  model: string;
  duration_ms: number;
  /** Origen: la consola web, otro agente vía A2A (ADR-011) o una deliberación de la Polis (ADR-013). */
  channel?: 'web' | 'a2a' | 'session';
  a2a_task_id?: string | null;
  guardrails?: GuardEvent[];
  /** Conversación de la consola a la que pertenece (ADR-014); ausente en ejecuciones antiguas. */
  conversation_id?: string | null;
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
  /** Llamadas y tokens atribuidos a este agente (ADR-013, fase 4); ausentes en ejecuciones antiguas. */
  llm_calls?: number;
  input_tokens?: number;
  output_tokens?: number;
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
  /** Configuración de la deliberación y cronología para el replay (ADR-013). */
  config?: Record<string, unknown>;
  events?: TimelineEvent[];
}
