export type Mode = 'single' | 'debate';

export interface ChatRequest {
  question: string;
  mode?: Mode;
  max_rounds?: number; // 1..4
  simulate?: boolean; // LLM determinista: recorre todo el grafo con 0 tokens
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

export interface Usage { calls: number; input_tokens: number; output_tokens: number; total_tokens: number; }

/** Inicio/fin de un nodo LangGraph; los internos llevan ruta: `anaximandro/act`. */
export interface NodeEvent { node: string; status: 'start' | 'end'; error: boolean; }

export type ChatEvent =
  | { type: 'trace'; data: { messages: string[] } }
  | { type: 'turn'; data: Turn }
  | { type: 'node'; data: NodeEvent }
  | { type: 'step'; data: AgentStep }
  | { type: 'answer'; data: { answer: string; mode: Mode; simulate?: boolean; usage?: Usage } }
  | { type: 'error'; data: { message: string; trace_id?: string } };
