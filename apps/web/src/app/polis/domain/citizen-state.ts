import type { AgentStep, GuardEvent, Turn } from '../../research/domain/chat.ts';
import type { GraphRun } from '../../research/domain/graph-run.ts';

/** Estado visible de un agente en la Polis. Caminar o subir a la tribuna son animaciones, no estados. */
export type CitizenState = 'idle' | 'working' | 'using_tool' | 'done' | 'degraded' | 'error';

/** Estado del núcleo de Ápeiron en el ágora. */
export type CoreState = 'idle' | 'routing' | 'supervising' | 'synthesizing' | 'done' | 'error';

/** Lo que la Polis lee de una ejecución (estructuralmente compatible con `RunState`). */
export interface RunView {
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  graph: GraphRun;
  turns: Turn[];
  steps: AgentStep[];
  guards: GuardEvent[];
}

/**
 * Estado de un agente derivado solo de eventos reales (ADR-013). `cancelRun`/`failRun` ya cierran los nodos
 * activos, así que tras cancelar, fallar o perder la conexión ningún agente queda trabajando.
 */
export function citizenState(run: RunView, agent: string): CitizenState {
  const node = run.graph.status[agent];
  if (run.status === 'running' && run.graph.status[`${agent}/act`] === 'active' && node === 'active') return 'using_tool';
  if (node === 'active') return run.status === 'running' ? 'working' : 'idle';
  if (node === 'error') return 'error';
  if (node === 'done') {
    const last = [...run.turns].reverse().find((t) => t.agent === agent);
    return last?.degraded ? 'degraded' : 'done';
  }
  return 'idle';
}

export function citizenStates(run: RunView, agents: string[]): Record<string, CitizenState> {
  return Object.fromEntries(agents.map((a) => [a, citizenState(run, a)]));
}

export function coreState(run: RunView): CoreState {
  const s = run.graph.status;
  if (run.status === 'error') return 'error';
  if (run.status === 'running') {
    if (s['apeiron_synthesis'] === 'active') return 'synthesizing';
    if (s['apeiron_router'] === 'active') return 'routing';
    return 'supervising';
  }
  return run.status === 'done' ? 'done' : 'idle';
}

/** Agentes que han actuado en la ejecución, en el orden en que entraron por primera vez. */
export function participants(run: RunView, agents: string[]): string[] {
  const known = new Set(agents);
  const order: string[] = [];
  for (const edge of run.graph.edges) {
    const to = edge.split('>')[1] ?? '';
    if (known.has(to) && !order.includes(to)) order.push(to);
  }
  return order;
}
