import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { ChatEvent, ChatRequest, Mode } from '../domain/chat';
import { groupConversations } from '../domain/conversation';
import { AgentExecution, RunRecord, RunSummary } from '../domain/run-record';
import { Topology } from '../domain/topology';
import { ChatStreamPort } from './ports/chat-stream.port';
import { RunHistoryRepository } from './ports/run-history.repository';
import { TopologyRepository } from './ports/topology.repository';
import { AgentDirectory } from './agent-directory';
import { Exchange, RunState, cancelRun, failRun, fromRecord, idleRun, reduceRunEvent, startRun } from './run-state';

/** Id de conversación nuevo (lo genera el cliente; la API solo agrupa ejecuciones del mismo usuario). */
function newConversationId(): string {
  return crypto.randomUUID();
}

/**
 * Estado de la consola: el hilo de la conversación (ADR-014) y, de la ejecución en curso, turnos, traza, grafo en
 * vivo y consumo. La Polis reutiliza solo la ejecución (`follow`).
 */
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
  readonly failure = computed(() => this.run$().failure);
  readonly graph = computed(() => this.run$().graph);
  readonly usage = computed(() => this.run$().usage);
  readonly guards = computed(() => this.run$().guards);
  readonly blocked = computed(() => this.run$().blocked);
  /** Instantánea de la sesión deliberativa en curso (Polis, ADR-013). */
  readonly session = computed(() => this.run$().session);

  /** Hilo de la consola (ADR-014): intercambios ya cerrados más el actual. */
  readonly conversationId = signal<string | null>(null);
  private readonly archived = signal<Exchange[]>([]);
  private readonly current = signal<{ question: string; mode: Mode; runId?: string } | null>(null);
  readonly thread = computed<Exchange[]>(() => {
    const current = this.current();
    return current ? [...this.archived(), { ...current, run: this.run$() }] : this.archived();
  });
  /** Conversaciones del historial (agrupadas por `conversation_id`). */
  readonly conversations = computed(() => groupConversations(this.history()));

  readonly simulated = signal(false);
  readonly elapsedMs = signal(0);
  readonly topology = signal<Topology | null>(null);
  readonly topologyError = signal(false);
  private readonly directory = inject(AgentDirectory);
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
      this.history.set(await this.runs.list(100));
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
      this.archived.set([]);
      this.showRecord(record);
      // Una ejecución antigua sin conversación abre una nueva al seguirla.
      this.conversationId.set(record.conversation_id ?? null);
      return record.question;
    } catch {
      this.historyError.set('No se pudo abrir la ejecución.');
      return null;
    }
  }

  /** Reabre una conversación completa del historial (ADR-014) para leerla o seguirla. */
  async openConversation(id: string): Promise<boolean> {
    this.sub?.unsubscribe();
    try {
      const records = await this.runs.conversation(id);
      const last = records.at(-1);
      if (!last) return false;
      this.archived.set(records.slice(0, -1).map((r) => ({
        question: r.question, mode: r.mode === 'debate' ? 'debate' : 'single', run: fromRecord(r), runId: r.id,
      })));
      this.showRecord(last);
      this.conversationId.set(id);
      return true;
    } catch {
      this.historyError.set('No se pudo abrir la conversación.');
      return false;
    }
  }

  private showRecord(record: RunRecord): void {
    this.run$.set(fromRecord(record));
    this.current.set({ question: record.question, mode: record.mode === 'debate' ? 'debate' : 'single', runId: record.id });
    this.simulated.set(record.simulate);
    this.elapsedMs.set(record.duration_ms);
    this.openedAgents.set(record.agent_executions ?? []);
    this.openedRunId.set(record.id);
  }

  /**
   * Pregunta dentro del hilo de la consola: archiva el intercambio anterior y envía la pregunta con el id de la
   * conversación, para que los agentes vean lo ya dicho (ADR-014).
   */
  ask(req: ChatRequest, mode: Mode): void {
    const previous = this.current();
    if (previous && this.status() !== 'idle') {
      this.archived.update((items) => [...items, { ...previous, run: this.run$() }]);
    }
    const conversation = this.conversationId() ?? newConversationId();
    this.conversationId.set(conversation);
    this.current.set({ question: req.question, mode });
    this.run({ ...req, conversation_id: conversation });
  }

  /** Empieza una conversación nueva (el hilo anterior sigue en el historial). */
  newConversation(): void {
    this.clear();
  }

  async loadTopology(): Promise<void> {
    if (this.topology()) return;
    try {
      const topology = await this.topologies.load();
      this.directory.learn(topology.agents);
      this.topology.set(topology);
      this.topologyError.set(false);
    } catch {
      this.topology.set(null); // sin topología no hay agentes que dibujar: la UI lo dice
      this.topologyError.set(true);
    }
  }

  run(req: ChatRequest): void {
    this.follow(this.chat.stream(req), !!req.simulate);
  }

  /**
   * Sigue cualquier flujo de eventos del contrato con el mismo reducer: el chat, una sesión deliberativa o la
   * reproducción de una crónica (ADR-013). Cancelar = `cancel()`.
   */
  follow(stream: Observable<ChatEvent>, simulate: boolean): void {
    this.sub?.unsubscribe();
    this.openedRunId.set(null);
    this.openedAgents.set([]);
    this.run$.set(startRun());
    this.simulated.set(simulate);
    this.elapsedMs.set(0);
    this.startedAt = performance.now();
    this.sub = stream.subscribe({
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
    this.archived.set([]);
    this.current.set(null);
    this.conversationId.set(null);
    this.openedRunId.set(null);
    this.openedAgents.set([]);
  }

  private apply(next: RunState): void {
    const wasRunning = this.status() === 'running';
    this.run$.set(next);
    if (wasRunning && next.status !== 'running') {
      this.elapsedMs.set(Math.round(performance.now() - this.startedAt));
    }
  }
}
