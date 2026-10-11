import type { AgentInfo } from './topology.ts';

/** Nombre visible de cada agente, tal como lo declara su manifiesto (ADR-013, catálogo de agentes): `heraclito` -> `Heráclito`. */
export type AgentNames = Readonly<Record<string, string>>;

/** Identidades del sistema, que no son agentes del catálogo. */
const SYSTEM_NAMES: AgentNames = {
  human: 'Ciudadano', // el usuario en una deliberación; la Polis usa su nombre visible
  apeiron: 'Ápeiron',
};

export function agentNames(agents: readonly AgentInfo[]): AgentNames {
  return Object.fromEntries(agents.filter((a) => a.display_name).map((a) => [a.name, a.display_name!]));
}

/** Nombre visible: el del manifiesto si se conoce; si no, el id con mayúscula inicial. */
export function agentLabel(name: string, names: AgentNames = {}): string {
  return SYSTEM_NAMES[name] ?? names[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}
