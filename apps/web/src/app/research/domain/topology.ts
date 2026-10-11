import type { Mode } from './chat.ts';

/** Lugar de un agente en la Polis, declarado en su manifiesto (ADR-013, catálogo de agentes). */
export interface AgentResidence {
  title: string;
  subtitle: string;
  landmark: string;
  color: string;
  epithet?: string;
}

export interface AgentInfo {
  name: string;
  role: string;
  tools: string[];
  /** local: ReAct en proceso · remote: otro agente vía A2A (ADR-011). */
  kind?: 'local' | 'remote';
  endpoint?: string;
  /** Manifiesto (ADR-013, catálogo de agentes); ausente en agentes remotos y en APIs anteriores. */
  display_name?: string;
  residence?: AgentResidence;
  /** Publicado como agente A2A propio en /a2a/agents/<name>. */
  a2a?: boolean;
  debate?: boolean;
  version?: string;
}

export interface Topology {
  orchestrator: string;
  agents: AgentInfo[];
  debate_participants: string[];
  modes: Mode[];
  llm: { provider: string; model: string };
  limits: {
    default_rounds: number;
    max_rounds: number;
    /** Sesiones de la Polis (ADR-013); ausentes en APIs anteriores. */
    max_participants?: number;
    session_max_llm_calls?: number;
    session_max_duration_s?: number;
  };
  /** Id del participante humano en las sesiones (ADR-013). */
  human?: string;
}
