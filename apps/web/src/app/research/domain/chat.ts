export type Mode = 'single' | 'debate';

export interface ChatRequest {
  question: string;
  mode?: Mode;
  max_rounds?: number; // 1..4
  simulate?: boolean; // LLM determinista: recorre todo el grafo con 0 tokens
  /** Interlocutor elegido (ADR-013): fuerza el modo `single`. */
  agent?: string;
}

export interface Turn {
  agent: string;
  round: number;
  text: string;
  degraded?: boolean;
  /** Interlocutor al que responde (su última posición estaba en el prompt). */
  responds_to?: string | null;
}

/** Paso ReAct observable: herramienta, entrada y observación (el Thought es privado). */
export interface AgentStep {
  agent: string;
  round: number;
  step: number;
  tool: string;
  input: string;
  observation: string;
  error: boolean;
  /** true si la consulta la lanzó el sistema (política de evidencia), no el agente. */
  auto?: boolean;
}

/** Intervención de un guardrail (ADR-011). Nunca incluye el texto evaluado. */
export interface GuardEvent {
  stage: 'input' | 'observation' | 'turn' | 'output';
  action: 'redact' | 'block';
  rules: string[];
  agent: string;
  round: number;
}

export interface Usage { calls: number; input_tokens: number; output_tokens: number; total_tokens: number; }

/** Inicio/fin de un nodo LangGraph; los internos llevan ruta: `anaximandro/act`. */
export interface NodeEvent { node: string; status: 'start' | 'end'; error: boolean; }

/** Estado de una sesión deliberativa de la Polis (ADR-013, fase 2). */
export type SessionStatus = 'running' | 'waiting' | 'closing' | 'completed' | 'cancelled' | 'error';

export interface SessionEvent {
  id: string;
  status: SessionStatus;
  /** Qué espera la sesión: el turno del usuario o la orden de continuar (ritmo paso a paso). */
  waiting: 'human_turn' | 'advance' | null;
  /** Plazo de la espera (epoch en segundos) o null si no tiene plazo propio. */
  deadline: number | null;
  next?: string;
  round?: number;
  responds_to?: string | null;
  participants: string[];
  /** Motivo del cierre o del final: closed_by_user, time_budget, max_duration, max_calls, cancelled_by_user... */
  reason: string | null;
  last_event: number;
}

export type ChatEvent =
  | { type: 'trace'; data: { messages: string[] } }
  | { type: 'turn'; data: Turn }
  | { type: 'node'; data: NodeEvent }
  | { type: 'step'; data: AgentStep }
  | { type: 'guard'; data: GuardEvent }
  | { type: 'answer'; data: { answer: string; mode: Mode; simulate?: boolean; blocked?: boolean; usage?: Usage } }
  | { type: 'session'; data: SessionEvent }
  | { type: 'error'; data: { message: string; trace_id?: string } };
