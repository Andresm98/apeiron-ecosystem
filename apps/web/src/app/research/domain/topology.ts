import type { Mode } from './chat.ts';

export interface AgentInfo { name: string; role: string; tools: string[]; }

export interface Topology {
  orchestrator: string;
  agents: AgentInfo[];
  debate_participants: string[];
  modes: Mode[];
  llm: { provider: string; model: string };
  limits: { default_rounds: number; max_rounds: number };
}

/** Topología conocida cuando la API aún no la ha publicado. */
export const DEFAULT_AGENTS: AgentInfo[] = [
  { name: 'anaximandro', role: 'Worker principal', tools: ['formal_logic_calculator'] },
  { name: 'heraclito', role: 'Worker dialéctico', tools: ['vector_memory_retriever'] },
];
