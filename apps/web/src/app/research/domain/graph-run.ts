import type { NodeEvent } from './chat.ts';

export type NodeStatus = 'idle' | 'active' | 'done' | 'error';

export const START = '__start__';
export const END = '__end__';

/** Estado del grafo en vivo, derivado solo de eventos `node` del stream (0 tokens extra). */
export interface GraphRun {
  status: Record<string, NodeStatus>;
  visits: Record<string, number>;
  edges: string[]; // transiciones del grafo raíz en orden: "apeiron_router>anaximandro"
  current: string | null; // último nodo raíz iniciado
}

export function emptyRun(): GraphRun {
  return { status: {}, visits: {}, edges: [], current: null };
}

export function applyNodeEvent(run: GraphRun, ev: NodeEvent): GraphRun {
  const status = { ...run.status };
  const visits = { ...run.visits };
  const edges = [...run.edges];
  let current = run.current;
  const isRoot = !ev.node.includes('/');

  if (ev.status === 'start') {
    status[ev.node] = 'active';
    visits[ev.node] = (visits[ev.node] ?? 0) + 1;
    if (isRoot) {
      edges.push(`${current ?? START}>${ev.node}`);
      current = ev.node;
    }
  } else {
    status[ev.node] = ev.error ? 'error' : 'done';
    if (ev.node === 'apeiron_synthesis' && !ev.error) edges.push(`${ev.node}>${END}`);
  }
  return { status, visits, edges, current };
}

export function edgeVisited(run: GraphRun, from: string, to: string): boolean {
  return run.edges.includes(`${from}>${to}`);
}

export function isLastEdge(run: GraphRun, from: string, to: string): boolean {
  return run.edges[run.edges.length - 1] === `${from}>${to}`;
}
