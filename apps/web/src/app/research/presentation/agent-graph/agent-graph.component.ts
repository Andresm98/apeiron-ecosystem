import { Component, computed, input } from '@angular/core';
import { END, GraphRun, NodeStatus, START, edgeVisited, isLastEdge } from '../../domain/graph-run';
import { AgentInfo, DEFAULT_AGENTS } from '../../domain/topology';
import { agentLabel } from '../agent-label';

const W = 320;
const MARGIN = 14;
const GAP = 12;
const ROUTER_Y = 46;
const WORKER_Y = 118;
const WORKER_H = 100;
const SUPERVISOR_Y = 276;
const SYNTHESIS_Y = 344;
const END_Y = 410;
const BOX_H = 34;

interface WorkerBox {
  name: string;
  role: string;
  x: number;
  w: number;
  cx: number;
  hasTools: boolean;
  remote: boolean;
  /** Caja estrecha (3–4 workers): un solo óvalo reason ⇄ act y contador corto. */
  compact: boolean;
}

/** Grafo Ápeiron en vivo: orquestador (router, supervisor, síntesis) y workers ReAct. */
@Component({
  selector: 'app-agent-graph',
  templateUrl: './agent-graph.component.html',
  styleUrl: './agent-graph.component.scss',
})
export class AgentGraphComponent {
  readonly run = input.required<GraphRun>();
  readonly agents = input<AgentInfo[] | undefined>();

  readonly W = W;
  readonly H = END_Y + 18;
  readonly cx = W / 2;
  readonly y = { router: ROUTER_Y, worker: WORKER_Y, workerH: WORKER_H, supervisor: SUPERVISOR_Y, synthesis: SYNTHESIS_Y, end: END_Y, box: BOX_H };
  readonly START = START;
  readonly END = END;

  readonly workers = computed<WorkerBox[]>(() => {
    const agents = this.agents()?.length ? this.agents()! : DEFAULT_AGENTS;
    const n = agents.length;
    const w = (W - MARGIN * 2 - GAP * (n - 1)) / n;
    return agents.map((a, i) => {
      const x = MARGIN + i * (w + GAP);
      return { name: a.name, role: a.role, x, w, cx: x + w / 2, hasTools: a.tools.length > 0, remote: a.kind === 'remote', compact: w < 120 };
    });
  });

  readonly activeNode = computed(() => {
    const status = this.run().status;
    const active = Object.keys(status).filter((k) => status[k] === 'active');
    return active.sort((a, b) => b.length - a.length)[0] ?? null; // el más interno
  });

  status(node: string): NodeStatus {
    return this.run().status[node] ?? 'idle';
  }

  /** Estado del ciclo ReAct en modo compacto: act si está activo, si no reason. */
  cycleStatus(worker: string): NodeStatus {
    const act = this.status(`${worker}/act`);
    return act === 'active' ? act : this.status(`${worker}/reason`);
  }

  visits(node: string): number {
    return this.run().visits[node] ?? 0;
  }

  edgeClass(from: string, to: string): string {
    const run = this.run();
    if (isLastEdge(run, from, to)) return 'edge edge-current';
    return edgeVisited(run, from, to) ? 'edge edge-visited' : 'edge';
  }

  /** Curva vertical entre dos puntos (forward: hacia abajo; back: hacia arriba). */
  curve(x1: number, y1: number, x2: number, y2: number): string {
    const my = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
  }

  readonly label = agentLabel;
}
