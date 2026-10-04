import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChatRequest } from '../domain/chat';
import { AgentExecution, RunSummary } from '../domain/run-record';
import { Topology } from '../domain/topology';
import { ChatStreamPort } from './ports/chat-stream.port';
import { RunHistoryRepository } from './ports/run-history.repository';
import { TopologyRepository } from './ports/topology.repository';
import { RunState, cancelRun, failRun, fromRecord, idleRun, reduceRunEvent, startRun } from './run-state';

/** Estado de la consola: turnos, traza, grafo en vivo y consumo de la ejecución. */
@Injectable()
export class ResearchStore {
  private chat = inject(ChatStreamPort);
  private topologies = inject(TopologyRepository);
  private runs = inject(RunHistoryRepository);
  private sub?: Subscription;
  private startedAt = 0;

  private readonly run$ = signal<RunState>(idleRun());
  readonly status = computed(() => this.run$().status);
  readonly trace = computed(() => this.run$().trace);
  readonly turns = computed(() => this.run$().turns);
  readonly steps = computed(() => this.run$().steps);
  readonly answer = computed(() => this.run$().answer);
  readonly error = computed(() => this.run$().error);
  readonly graph = computed(() => this.run$().graph);
  readonly usage = computed(() => this.run$().usage);

  readonly simulated = signal(false);
  readonly elapsedMs = signal(0);
  readonly topology = signal<Topology | null>(null);
  readonly history = signal<RunSummary[]>([]);
  readonly historyError = signal('');
  readonly openedRunId = signal<string | null>(null);
  /** Agentes ejecutados de la ejecución reabierta (registro persistido en Supabase). */
  readonly openedAgents = signal<AgentExecution[]>([]);
  private historyEnabled = false;

  /** Historial persistido (Supabase). Se refresca solo al terminar cada ejecución. */
  async loadHistory(): Promise<void> {
    this.historyEnabled = true;
    try {
      this.history.set(await this.runs.list(20));
      this.historyError.set('');
    } catch {
      this.historyError.set('No se pudo cargar el historial.');
    }
  }

  /** Reabre una ejecución guardada en la consola; devuelve su pregunta. */
  async openRun(id: string): Promise<string | null> {
    this.sub?.unsubscribe();
    try {
      const record = await this.runs.get(id);
      this.run$.set(fromRecord(record));
      this.simulated.set(record.simulate);
      this.elapsedMs.set(record.duration_ms);
      this.openedAgents.set(record.agent_executions ?? []);
      this.openedRunId.set(id);
      return record.question;
    } catch {
      this.historyError.set('No se pudo abrir la ejecución.');
      return null;
    }
  }

  async loadTopology(): Promise<void> {
    if (this.topology()) return;
    try {
      this.topology.set(await this.topologies.load());
    } catch {
      this.topology.set(null); // el grafo usa la topología por defecto
    }
  }

  run(req: ChatRequest): void {
    this.sub?.unsubscribe();
    this.openedRunId.set(null);
    this.openedAgents.set([]);
    this.run$.set(startRun());
    this.simulated.set(!!req.simulate);
    this.elapsedMs.set(0);
    this.startedAt = performance.now();
    this.sub = this.chat.stream(req).subscribe({
      next: (ev) => this.apply(reduceRunEvent(this.run$(), ev)),
      error: (e: unknown) => this.apply(failRun(this.run$(), e instanceof Error ? e.message : String(e))),
      // El stream cierra después de que la API persiste la ejecución: ahora sí está en el historial.
      complete: () => {
        if (this.historyEnabled) void this.loadHistory();
      },
    });
  }

  cancel(): void {
    this.sub?.unsubscribe();
    if (this.status() === 'running') this.apply(cancelRun(this.run$()));
  }

  clear(): void {
    this.sub?.unsubscribe();
    this.run$.set(idleRun());
    this.elapsedMs.set(0);
  }

  private apply(next: RunState): void {
    const wasRunning = this.status() === 'running';
    this.run$.set(next);
    if (wasRunning && next.status !== 'running') {
      this.elapsedMs.set(Math.round(performance.now() - this.startedAt));
    }
  }
}
