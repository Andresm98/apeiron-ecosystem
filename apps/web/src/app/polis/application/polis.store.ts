import { DestroyRef, Injectable, computed, inject, linkedSignal, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { SessionStore } from '../../auth/application/session.store';
import { overallHealth, SystemStatus } from '../../observatory/domain/system-status';
import { SystemStatusRepository } from '../../observatory/application/ports/system-status.repository';
import { ResearchStore } from '../../research/application/research.store';
import { RunHistoryRepository } from '../../research/application/ports/run-history.repository';
import { ChatEvent } from '../../research/domain/chat';
import { AgentExecution } from '../../research/domain/run-record';
import { AGORA_ID, Place, layoutCity } from '../domain/city-layout';
import { RunView, citizenStates, coreState, participants } from '../domain/citizen-state';
import { DeliberationDraft, DeliberationRequest, HUMAN, defaultDraft, draftProblem, toRequest } from '../domain/deliberation';
import { LinkStatus, OpenSession, resumable } from '../domain/hud';
import { ReplayStep, replayPlan } from '../domain/replay';
import { DeliberationPort } from './ports/deliberation.port';

/** Lo que tardan los convocados en llegar al ágora (los trayectos largos se aceleran para cumplirlo). */
const GATHERING_MS = 1400;
const BEACON_REFRESH_MS = 30_000;

/** Lo que se pidió al convocar: da el progreso («ronda 2 de 3», tiempo restante) y el plazo total del turno. */
export interface SessionPlan {
  maxRounds: number | null;
  openEnded: boolean;
  /** Presupuesto de tiempo en segundos y momento de inicio (epoch en ms). */
  budgetS: number | null;
  startedAt: number;
  replyS: number | null;
}

/** Dónde se celebra la ejecución en curso: en el ágora (debate) o en el lugar de un agente (consulta). */
export type Venue = { kind: 'agora' } | { kind: 'agent'; agent: string };

/** Emite una cronología guardada con su ritmo; cancelar = desuscribirse (limpia los temporizadores). */
function play(plan: ReplayStep[]): Observable<ChatEvent> {
  return new Observable<ChatEvent>((sub) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = (i: number) => {
      if (i >= plan.length) return sub.complete();
      timer = setTimeout(() => {
        sub.next(plan[i]!.event);
        next(i + 1);
      }, plan[i]!.delay);
    };
    next(0);
    return () => clearTimeout(timer);
  });
}

/**
 * Estado de la Polis (ADR-013). No ejecuta nada: proyecta la ejecución del `ResearchStore` (mismo reducer que
 * la consola) en lugares y ciudadanos, y traslada las órdenes del usuario al backend: preguntar a un agente,
 * convocar y gobernar una deliberación, reproducir una crónica.
 */
@Injectable()
export class PolisStore {
  readonly research = inject(ResearchStore);
  private readonly deliberations = inject(DeliberationPort);
  private readonly runs = inject(RunHistoryRepository);
  private readonly systems = inject(SystemStatusRepository);
  private readonly auth = inject(SessionStore);

  readonly agents = computed(() => this.research.topology()?.agents ?? []);
  readonly agentNames = computed(() => this.agents().map((a) => a.name));
  /** Nombre visible del usuario: ssanax por defecto, la parte local del correo con Supabase. */
  readonly player = computed(() => (this.auth.username() ?? 'ssanax').split('@')[0] || 'ssanax');
  readonly places = computed<Place[]>(() => layoutCity(this.agents(), this.player()));
  /** La ciudad no se pudo fundar: sin topología no hay agentes que dibujar (la UI ofrece reintentar). */
  readonly topologyError = this.research.topologyError;
  readonly debateParticipants = computed(
    () => this.research.topology()?.debate_participants ?? this.agentNames().slice(0, 2),
  );
  readonly maxCalls = computed(() => this.research.topology()?.limits.session_max_llm_calls ?? 60);

  readonly run = computed<RunView>(() => ({
    status: this.research.status(),
    graph: this.research.graph(),
    turns: this.research.turns(),
    steps: this.research.steps(),
    guards: this.research.guards(),
  }));
  readonly citizens = computed(() => citizenStates(this.run(), this.agentNames()));
  readonly core = computed(() => coreState(this.run()));
  readonly acting = computed(() => participants(this.run(), this.agentNames()));

  /** Los convocados caminan al ágora; la sesión se crea al terminar el trayecto. */
  readonly gathering = signal(false);
  readonly running = computed(() => this.gathering() || this.research.status() === 'running');
  private gatherTimer: ReturnType<typeof setTimeout> | null = null;

  readonly venue = signal<Venue | null>(null);
  /** Participantes de la deliberación pedidos por el usuario (antes de que la sesión los confirme). */
  private readonly called = signal<string[]>([]);
  /** Convocados al ágora (sin el humano, que es ssanax): configuración real, no actividad simulada. */
  readonly summoned = computed(() => {
    if (this.venue()?.kind !== 'agora') return [];
    const session = this.research.session()?.participants ?? [];
    const all = new Set([...this.called(), ...session, ...this.acting()]);
    return this.agentNames().filter((a) => all.has(a));
  });

  /** Sesión deliberativa en curso (fase 2). */
  readonly sessionId = signal<string | null>(null);
  readonly session = computed(() => (this.sessionId() ? this.research.session() : null));
  readonly waitingForMe = computed(() => this.session()?.status === 'waiting' && this.session()?.waiting === 'human_turn');
  readonly waitingAdvance = computed(() => this.session()?.status === 'waiting' && this.session()?.waiting === 'advance');
  readonly sessionParticipants = computed(() => this.session()?.participants ?? this.called());
  /** Borrador de la tribuna: por defecto, los debatientes que publica la topología y ssanax. */
  readonly draft = linkedSignal<DeliberationDraft>(() => defaultDraft([...this.debateParticipants(), HUMAN]));
  readonly notice = signal('');
  readonly busy = signal(false);
  /** Plan de la sesión convocada desde aquí; null si se reanudó (no se conoce su configuración). */
  readonly plan = signal<SessionPlan | null>(null);
  /** Enlace SSE con la sesión: el adaptador cuenta los reintentos. */
  readonly link = signal<LinkStatus>({ kind: 'online' });
  /** Sesiones abiertas al entrar (p. ej. tras un reinicio de la API): se ofrece reanudarlas. */
  readonly openSessions = signal<OpenSession[]>([]);
  private readonly resumeDismissed = signal(false);
  readonly resumeOffer = computed(() =>
    this.resumeDismissed() || this.sessionId() || this.running() ? null : resumable(this.openSessions()),
  );

  /** Reproducción de una crónica (fase 4). */
  readonly replaying = signal<string | null>(null);
  readonly replayAgents = signal<AgentExecution[]>([]);
  readonly historyEnabled = computed(() => this.auth.capabilities().runsEnabled);

  /** El Faro (fase 4): estado del sistema. */
  readonly system = signal<SystemStatus | null>(null);
  readonly beacon = computed(() => {
    const status = this.system();
    return status ? overallHealth(status.components) : null;
  });

  /** Lugar junto al que está ssanax, y lugar cuyo diálogo está abierto. */
  readonly near = signal<string | null>(null);
  readonly selected = signal<string | null>(null);
  readonly selectedPlace = computed(() => this.places().find((p) => p.id === this.selected()) ?? null);
  readonly nearPlace = computed(() => this.places().find((p) => p.id === this.near()) ?? null);

  readonly simulate = signal(true); // 0 tokens por defecto, como en la consola

  constructor() {
    void this.loadSystem();
    void this.loadOpenSessions();
    const timer = setInterval(() => void this.loadSystem(), BEACON_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      if (this.gatherTimer) clearTimeout(this.gatherTimer);
    });
  }

  lastTurn(agent: string) {
    return [...this.research.turns()].reverse().find((t) => t.agent === agent) ?? null;
  }

  stepsOf(agent: string) {
    return this.research.steps().filter((s) => s.agent === agent);
  }

  /** Consulta a un agente concreto, en su propio lugar (fase 1). */
  ask(agent: string, question: string): void {
    const text = question.trim();
    if (!text || this.running()) return;
    this.reset();
    this.venue.set({ kind: 'agent', agent });
    this.research.run({ question: text, agent, simulate: this.simulate() });
  }

  /** Problema del formulario de la tribuna, o null si se puede convocar. */
  draftProblem(question: string): string | null {
    return draftProblem(this.draft(), question, this.agentNames());
  }

  /** Convoca una deliberación (fase 2): los convocados acuden y, al llegar, empieza la sesión. */
  convene(question: string): void {
    const problem = this.draftProblem(question);
    if (problem) return this.notice.set(problem);
    if (this.running()) return;
    const draft = this.draft();
    const request = toRequest(question, draft, this.simulate());
    this.reset();
    this.called.set(draft.participants);
    this.venue.set({ kind: 'agora' });
    this.gathering.set(true);
    this.gatherTimer = setTimeout(async () => {
      this.gatherTimer = null;
      try {
        const session = await this.deliberations.create(request);
        this.plan.set(planOf(request));
        this.attach(session.id, request.simulate);
      } catch (e) {
        this.notice.set(e instanceof Error ? e.message : String(e));
        this.venue.set(null);
      } finally {
        this.gathering.set(false);
      }
    }, GATHERING_MS);
  }

  /** Vuelve a una sesión abierta: la ciudad se reconstruye desde el evento 0 con el mismo reducer. */
  resume(sessionId: string): void {
    if (this.running()) return;
    const offer = this.openSessions().find((s) => s.id === sessionId);
    this.reset();
    this.called.set(offer?.participants ?? []);
    this.venue.set({ kind: 'agora' });
    this.attach(sessionId, this.simulate());
    this.openSessions.update((list) => list.filter((s) => s.id !== sessionId));
  }

  dismissResume(): void {
    this.resumeDismissed.set(true);
  }

  async loadOpenSessions(): Promise<void> {
    try {
      this.openSessions.set(await this.deliberations.list());
    } catch {
      this.openSessions.set([]); // sin lista no hay aviso: la Polis sigue funcionando
    }
  }

  retryTopology(): Promise<void> {
    return this.research.loadTopology();
  }

  /** Turno de ssanax; texto vacío = pasar. Si el guardrail lo bloquea, la sesión sigue esperando. */
  async speak(text: string): Promise<boolean> {
    const id = this.sessionId();
    if (!id) return false;
    return this.command(async () => {
      const result = await this.deliberations.turn(id, text.trim());
      if (!result.accepted) {
        this.notice.set('Ápeiron no admite ese texto como turno (guardrail de entrada). Reformúlalo.');
        return false;
      }
      return true;
    });
  }

  advance(): Promise<boolean> {
    return this.withSession((id) => this.deliberations.advance(id));
  }

  invite(agent: string): Promise<boolean> {
    return this.withSession(async (id) => {
      await this.deliberations.invite(id, agent);
      this.called.update((list) => (list.includes(agent) ? list : [...list, agent]));
    });
  }

  closeSession(): Promise<boolean> {
    return this.withSession((id) => this.deliberations.close(id));
  }

  cancel(): void {
    if (this.gatherTimer) {
      clearTimeout(this.gatherTimer);
      this.gatherTimer = null;
      this.gathering.set(false);
      this.venue.set(null); // nadie llegó a deliberar: vuelven a casa
      return;
    }
    const id = this.sessionId();
    if (id && this.session()?.status !== 'completed') void this.deliberations.cancel(id).catch(() => undefined);
    this.research.cancel();
  }

  /** Despide la asamblea: los ciudadanos vuelven a casa y se limpia la ejecución. */
  dismiss(): void {
    if (this.running()) return;
    this.reset();
    this.research.clear();
  }

  /** Reproduce una crónica del Archivo con su ritmo original (comprimido) en la propia ciudad (fase 4). */
  async replay(runId: string): Promise<void> {
    if (this.running()) return;
    try {
      const record = await this.runs.get(runId);
      const plan = replayPlan(record.events ?? []);
      if (!plan.length) return this.notice.set('Esta crónica es anterior al replay: no guardó su cronología.');
      this.reset();
      const firstAgent = record.turns.find((t) => t.agent !== HUMAN)?.agent;
      if (record.mode === 'debate') {
        const configured = (record.config?.['participants'] as string[] | undefined) ?? record.turns.map((t) => t.agent);
        this.called.set([...new Set(configured)]);
        this.venue.set({ kind: 'agora' });
      } else if (firstAgent) {
        this.venue.set({ kind: 'agent', agent: firstAgent });
      }
      this.replaying.set(runId);
      this.replayAgents.set(record.agent_executions ?? []);
      this.research.follow(play(plan), record.simulate);
    } catch {
      this.notice.set('No se pudo abrir la crónica.');
    }
  }

  async loadHistory(): Promise<void> {
    if (this.historyEnabled()) await this.research.loadHistory();
  }

  async loadSystem(): Promise<void> {
    try {
      this.system.set(await this.systems.load());
    } catch {
      this.system.set(null); // el Faro se apaga: no hay datos, no "todo bien"
    }
  }

  interact(placeId: string | null): void {
    this.selected.set(placeId);
    this.notice.set('');
  }

  isAgora(placeId: string | null): boolean {
    return placeId === AGORA_ID;
  }

  private attach(sessionId: string, simulate: boolean): void {
    this.sessionId.set(sessionId);
    this.link.set({ kind: 'online' });
    this.research.follow(this.deliberations.events(sessionId, (status) => this.link.set(status)), simulate);
  }

  private reset(): void {
    this.sessionId.set(null);
    this.plan.set(null);
    this.link.set({ kind: 'online' });
    this.replaying.set(null);
    this.replayAgents.set([]);
    this.called.set([]);
    this.venue.set(null);
    this.notice.set('');
  }

  private withSession(fn: (id: string) => Promise<void>): Promise<boolean> {
    const id = this.sessionId();
    if (!id) return Promise.resolve(false);
    return this.command(async () => {
      await fn(id);
      return true;
    });
  }

  private async command(fn: () => Promise<boolean>): Promise<boolean> {
    this.busy.set(true);
    this.notice.set('');
    try {
      return await fn();
    } catch (e) {
      this.notice.set(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}

function planOf(request: DeliberationRequest): SessionPlan {
  return {
    maxRounds: request.open_ended ? null : (request.max_rounds ?? null),
    openEnded: !!request.open_ended,
    budgetS: request.time_budget_s ?? null,
    startedAt: Date.now(),
    replyS: request.participants.includes(HUMAN) ? request.human_turn_timeout_s : null,
  };
}
