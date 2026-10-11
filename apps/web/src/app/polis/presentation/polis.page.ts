import { Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HEALTH_ICON, HEALTH_LABEL } from '../../observatory/domain/system-status';
import { AgentDirectory } from '../../research/application/agent-directory';
import { excerpt } from '../../research/domain/dialogue';
import { RunSummary } from '../../research/domain/run-record';
import { AgentGraphComponent } from '../../research/presentation/agent-graph/agent-graph.component';
import { PolisStore } from '../application/polis.store';
import { BRIDGE_WIDTH, HOME_ID, Place, toolPlaceId } from '../domain/city-layout';
import { HUD_TOKENS, PerfSample, QUALITY_LABEL, QUALITY_LEVELS, Quality, initialQuality, isQuality, overBudget } from '../domain/atmosphere';
import { CitizenState, CoreState } from '../domain/citizen-state';
import { DeliberationDraft, HUMAN, MAX_PARTICIPANTS, estimateCalls, reasonLabel, secondsLeft } from '../domain/deliberation';
import { ONBOARDING_KEY, Whereabouts, chronicle, countdown, linkLabel, progressLine, roster } from '../domain/hud';
import { EMPTY_CURSOR, SignalCursor, readSignals } from '../domain/signals';
import type { PolisWorld } from './engine/world';
import { PolisChronicleComponent } from './hud/chronicle.component';
import { PolisJoystickComponent } from './hud/joystick.component';
import { PolisMinimapComponent } from './hud/minimap.component';
import { PolisOnboardingComponent } from './hud/onboarding.component';
import { PolisResumeBannerComponent } from './hud/resume-banner.component';
import { PolisRosterComponent } from './hud/roster.component';
import { PolisTribuneComponent, TribuneCitizen } from './hud/tribune.component';
import { PolisTurnBarComponent, TurnBarMode } from './hud/turn-bar.component';

const STATE_TEXT: Record<CitizenState, string> = {
  idle: 'En su lugar', working: 'Razonando', using_tool: 'Consultando una herramienta',
  done: 'Ha hablado', degraded: 'Respuesta degradada', error: 'Error',
};

const CORE_TEXT: Record<CoreState, string> = {
  idle: 'Ápeiron en calma', routing: 'Ápeiron decide el camino', supervising: 'Ápeiron modera',
  synthesizing: 'Ápeiron sintetiza', done: 'Deliberación cerrada', error: 'La ejecución falló',
};

const EYEBROW: Record<Place['kind'], string> = {
  agora: 'Centro de la polis', agent: 'Morada', foreign: 'Forastero · A2A', tool: 'Herramienta',
  home: 'Tu casa', archive: 'Crónicas', beacon: 'Salud del sistema',
};

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false; // sin almacenamiento (modo privado, previsualización): se vuelve a enseñar, no falla
  }
}

function writeFlag(key: string, value = '1'): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* preferencia de comodidad: perderla no importa */
  }
}

function readValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const QUALITY_KEY = 'apeiron-polis-quality';
const params = () => new URLSearchParams(window.location.search);

/**
 * La Polis (ADR-013): ssanax recorre la ciudad, pregunta, convoca y delibera con los agentes. La página compone el
 * escenario (motor Three.js fuera de Angular) y el HUD (capa 4: componentes standalone en `hud/`).
 */
@Component({
  selector: 'app-polis-page',
  imports: [
    FormsModule, RouterLink, AgentGraphComponent, PolisChronicleComponent, PolisJoystickComponent, PolisMinimapComponent,
    PolisOnboardingComponent, PolisResumeBannerComponent, PolisRosterComponent, PolisTribuneComponent, PolisTurnBarComponent,
  ],
  templateUrl: './polis.page.html',
  styleUrls: ['./polis.page.scss', './polis-assembly.scss'],
})
export class PolisPage implements OnInit {
  readonly polis = inject(PolisStore);
  readonly state = this.polis.research;
  private readonly directory = inject(AgentDirectory);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly turnBar = viewChild(PolisTurnBarComponent);

  readonly excerpt = excerpt;
  readonly stateText = STATE_TEXT;
  readonly eyebrow = EYEBROW;
  readonly bridgeWidth = BRIDGE_WIDTH;
  readonly human = HUMAN;
  readonly maxParticipants = MAX_PARTICIPANTS;
  readonly healthLabel = HEALTH_LABEL;
  readonly healthIcon = HEALTH_ICON;
  readonly reasonLabel = reasonLabel;

  /** Sin WebGL o con movimiento reducido, la Polis ofrece la consola y el grafo SVG. */
  readonly fallback = signal(false);
  readonly ready = signal(false);
  readonly mapOpen = signal(false);
  /** Nivel forzado por la URL (`?quality=low`, lo usa CI) o elegido antes en ajustes: el regulador no lo toca. */
  private readonly forcedQuality = params().get('quality');
  private readonly chosenQuality = readValue(QUALITY_KEY);
  readonly quality = signal<Quality>(initialQuality({
    coarse: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    forced: this.forcedQuality,
    chosen: this.chosenQuality,
  }));
  readonly qualityLevels = QUALITY_LEVELS;
  readonly qualityLabel = QUALITY_LABEL;
  /** Overlay de rendimiento (`?perf`): FPS, ms, draw calls y triángulos frente a los presupuestos de 5.7. */
  readonly perfEnabled = params().has('perf');
  readonly perf = signal<PerfSample | null>(null);
  readonly perfProblems = computed(() => {
    const sample = this.perf();
    return sample ? overBudget(sample) : [];
  });
  readonly hovered = signal<string | null>(null);
  /** Reloj para las cuentas atrás (se actualiza cada segundo). */
  readonly now = signal(Date.now());
  /** Puntero grueso (táctil): joystick visible, botones de mapa e interacción, crónica plegada. */
  readonly coarse = signal(window.matchMedia?.('(pointer: coarse)').matches ?? false);
  /** Posición de ssanax para el minimapa (el motor la envía a ≤ 10 Hz). */
  readonly where = signal<Whereabouts | null>(null);
  readonly onboarding = signal(!readFlag(ONBOARDING_KEY));

  readonly playerName = this.polis.player;
  readonly coreText = computed(() => {
    if (this.polis.gathering()) return 'Los convocados acuden al ágora';
    if (this.polis.waitingForMe()) return 'Tu turno';
    if (this.polis.waitingAdvance()) return `Esperando tu señal · siguiente: ${this.who(this.polis.session()?.next ?? '')}`;
    return CORE_TEXT[this.polis.core()];
  });
  /** Estado de la crónica: núcleo de Ápeiron y matices (cancelada, crónica, simulación, motivo del cierre). */
  readonly chronicleStatus = computed(() => {
    const parts = [this.coreText()];
    if (this.state.status() === 'cancelled') parts.push('cancelada');
    if (this.polis.replaying()) parts.push('crónica');
    if (this.state.simulated() && this.state.status() !== 'idle') parts.push('simulación');
    const reason = this.polis.session()?.reason;
    if (reason) parts.push(reasonLabel(reason));
    return parts.join(' · ');
  });
  readonly chronicleCore = computed(() => (this.polis.waitingForMe() ? 'turn' : this.polis.core()));
  readonly entries = computed(() => chronicle(this.state.turns(), this.state.steps(), this.state.answer()));
  readonly problem = computed(() => {
    const error = this.state.error();
    if (error) return `${this.state.failure() === 'network' ? 'Conexión perdida' : 'Fallo del servidor'} · ${error}`;
    return this.sessionOpen() ? linkLabel(this.polis.link()) : null;
  });
  readonly citizensDock = computed(() =>
    roster(
      this.polis.agentNames(), this.polis.citizens(),
      this.sessionOpen() ? this.polis.sessionParticipants() : this.polis.summoned(),
      this.polis.waitingAdvance() ? this.polis.session()?.next : null,
    ),
  );
  readonly tribuneCitizens = computed<TribuneCitizen[]>(() =>
    this.polis.agents().map((a) => ({ name: a.name, label: this.who(a.name), color: this.colorOf(a.name), role: a.role })),
  );
  readonly turnMode = computed<TurnBarMode>(() =>
    this.polis.waitingForMe() ? 'turn' : this.polis.waitingAdvance() ? 'advance' : 'watch',
  );
  readonly turnCountdown = computed(() =>
    countdown(secondsLeft(this.polis.session()?.deadline ?? null, this.now()), this.polis.plan()?.replyS ?? null),
  );
  readonly progress = computed(() => {
    const session = this.polis.session();
    if (!session) return '';
    const plan = this.polis.plan();
    const budgetLeft = plan?.budgetS ? plan.budgetS - (this.now() - plan.startedAt) / 1000 : null;
    return progressLine({
      ...(session.round !== undefined ? { round: session.round } : {}),
      ...(this.polis.waitingAdvance() && session.next ? { next: session.next } : {}),
      maxRounds: plan?.maxRounds ?? null, openEnded: plan?.openEnded ?? false, budgetLeft,
    }, (a) => this.who(a));
  });
  readonly estimate = computed(() => estimateCalls(this.polis.draft(), this.polis.maxCalls()));
  readonly invitable = computed(() => {
    const present = new Set(this.polis.sessionParticipants());
    return [...this.polis.agentNames(), HUMAN].filter((a) => !present.has(a));
  });
  readonly sessionOpen = computed(() => {
    const status = this.polis.session()?.status;
    return !!status && !['completed', 'cancelled', 'error'].includes(status);
  });
  /** El minimapa cede su sitio a los paneles grandes (diálogo, mapa, bienvenida). */
  readonly showMinimap = computed(() => !this.mapOpen() && !this.polis.selected() && !this.onboarding());
  readonly mapBox = computed(() => {
    const extent = Math.max(...this.polis.places().map((p) => Math.hypot(p.x, p.z) + p.radius), 30) + 6;
    return `${-extent} ${-extent} ${extent * 2} ${extent * 2}`;
  });

  question = '';

  private world: PolisWorld | null = null;
  private cursor: SignalCursor = EMPTY_CURSOR;

  constructor() {
    // Tokens del HUD desde el dominio: una sola fuente, con el contraste AA comprobado en `atmosphere.spec.ts`.
    const hostStyle = (inject(ElementRef).nativeElement as HTMLElement).style;
    for (const [name, value] of Object.entries(HUD_TOKENS)) hostStyle.setProperty(`--${name}`, value);
    // Deliberación, diálogo o turno -> sin profundidad de campo: la escena debe leerse entera.
    effect(() => {
      const locked = this.sessionOpen() || this.polis.running() || !!this.polis.selected() || this.mapOpen();
      untracked(() => this.world?.setFocusLock(locked));
    });
    // Llega la síntesis -> ssanax asiente.
    let answered = '';
    effect(() => {
      const answer = this.state.answer();
      if (answer && answer !== answered) untracked(() => this.world?.gesture('nod'));
      answered = answer;
    });
    // Topología -> ciudad.
    effect(() => {
      const places = this.polis.places();
      untracked(() => this.world?.setCity(places, (agent) => this.who(agent)));
    });
    // Ejecución -> estados, convocados y turno de ssanax.
    effect(() => {
      const view = {
        states: this.polis.citizens(), core: this.polis.core(), summoned: this.polis.summoned(),
        myTurn: this.polis.waitingForMe(),
      };
      untracked(() => this.world?.setScene(view));
    });
    // Salud del sistema -> luz del Faro.
    effect(() => {
      const health = this.polis.beacon();
      untracked(() => this.world?.setBeacon(health));
    });
    // Listas que solo crecen -> señales (pulsos, haces, mensajeros, destellos).
    effect(() => {
      const read = readSignals(this.polis.run(), this.cursor);
      this.cursor = read.cursor;
      if (read.signals.length) untracked(() => this.world?.emit(read.signals));
    });
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(tick));
  }

  async ngOnInit(): Promise<void> {
    void this.state.loadTopology();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const engine = await import('./engine/world');
    if (reduced || !engine.canRenderWebGL()) {
      this.fallback.set(true);
      return;
    }
    const host = this.stage()?.nativeElement;
    if (!host) return;
    this.world = new engine.PolisWorld(host, {
      near: (id) => this.polis.near.set(id),
      hover: (id) => this.hovered.set(id),
      select: (id) => this.open(id),
      map: () => this.mapOpen.update((v) => !v),
      escape: () => (this.mapOpen() ? this.mapOpen.set(false) : this.close()),
      position: (where) => this.where.set(where),
      quality: (level) => this.quality.set(level),
      perf: (sample) => this.perf.set(sample),
    }, this.playerName(), {
      intro: true,
      quality: this.quality(),
      autoQuality: !isQuality(this.forcedQuality) && !isQuality(this.chosenQuality),
      perf: this.perfEnabled,
      reducedMotion: reduced,
    });
    this.world.setFocusLock(this.sessionOpen() || this.polis.running() || !!this.polis.selected());
    this.world.setCity(this.polis.places(), (agent) => this.who(agent));
    this.world.setScene({
      states: this.polis.citizens(), core: this.polis.core(), summoned: this.polis.summoned(),
      myTurn: this.polis.waitingForMe(),
    });
    this.world.setBeacon(this.polis.beacon());
    this.cursor = readSignals(this.polis.run(), EMPTY_CURSOR).cursor; // no reanimar lo ya ocurrido
    this.ready.set(true);
    this.destroyRef.onDestroy(() => {
      this.world?.dispose();
      this.world = null;
    });
  }

  colorOf(agent: string): string {
    return this.polis.places().find((p) => p.agent === agent)?.color ?? '#8a857b';
  }

  /** Dock de ciudadanos: lleva a ssanax al lugar del agente (o al ágora si delibera allí). */
  goToCitizen(agent: string): void {
    const inAgora = this.citizensDock().find((c) => c.name === agent)?.inAgora;
    const place = this.polis.places().find((p) => (inAgora ? p.kind === 'agora' : p.agent === agent));
    if (place) this.travel(place);
  }

  finishOnboarding(): void {
    writeFlag(ONBOARDING_KEY);
    this.onboarding.set(false);
    this.world?.skipIntro();
  }

  showHelp(): void {
    this.onboarding.set(true);
  }

  stick(v: { x: number; y: number }): void {
    this.world?.stick(v.x, v.y);
  }

  /** Nombre visible: `human` es el propio usuario (ssanax). */
  who(agent: string): string {
    return agent === HUMAN ? this.playerName() : this.directory.label(agent);
  }

  open(placeId: string): void {
    this.polis.interact(placeId);
    this.mapOpen.set(false);
    const kind = this.polis.places().find((p) => p.id === placeId)?.kind;
    if (kind === 'archive') void this.polis.loadHistory();
    if (kind === 'beacon') void this.polis.loadSystem();
  }

  close(): void {
    this.polis.interact(null);
  }

  travel(place: Place): void {
    this.world?.travel(place.id);
    this.mapOpen.set(false);
  }

  setQuality(quality: Quality): void {
    this.quality.set(quality);
    writeFlag(QUALITY_KEY, quality);
    this.world?.setQuality(quality);
  }

  ask(agent: string): void {
    this.polis.ask(agent, this.question);
    this.question = '';
  }

  convene(question: string): void {
    const valid = !this.polis.draftProblem(question) && !this.polis.running();
    this.polis.convene(question);
    if (valid) this.world?.gesture('summon'); // ssanax convoca con los brazos en alto
  }

  invite(agent: string): void {
    void this.polis.invite(agent);
    this.world?.gesture('beckon');
  }

  /** Botones táctiles: saltar y saludar. */
  jump(): void {
    this.world?.jump();
  }

  wave(): void {
    this.world?.gesture('wave');
  }

  async speak(text: string): Promise<void> {
    if (await this.polis.speak(text)) this.turnBar()?.clear();
  }

  pass(): void {
    void this.polis.speak('');
    this.world?.gesture('shrug');
  }

  setDraft(draft: DeliberationDraft): void {
    this.polis.draft.set(draft);
  }

  resume(sessionId: string): void {
    this.polis.resume(sessionId);
    const agora = this.polis.places().find((p) => p.kind === 'agora');
    if (agora) this.travel(agora);
  }

  stateOf(agent: string): CitizenState {
    return this.polis.citizens()[agent] ?? 'idle';
  }

  /** Verbo del aviso de proximidad. */
  verb(place: Place): string {
    if (place.kind === 'agora') return 'Entrar en el';
    if (place.kind === 'agent' || place.kind === 'foreign') return `Hablar con ${this.who(place.agent ?? '')} en`;
    if (place.id === HOME_ID) return 'Entrar en la';
    if (place.kind === 'archive') return 'Consultar el';
    if (place.kind === 'beacon') return 'Subir a';
    return 'Visitar';
  }

  /** Agentes que usan alguna herramienta servida en este edificio. */
  usersOf(place: Place): string[] {
    const served = new Set(place.tools ?? []);
    return this.polis.agents().filter((a) => a.tools.some((t) => served.has(t))).map((a) => a.name);
  }

  /** Últimas consultas atendidas en este edificio. */
  visitsTo(place: Place) {
    return this.state.steps().filter((s) => toolPlaceId(s.tool) === place.id).slice(-4).reverse();
  }

  buildingOf(tool: string): string {
    const id = toolPlaceId(tool);
    return this.polis.places().find((p) => p.id === id)?.title ?? tool;
  }

  runLabel(run: RunSummary): string {
    const when = new Date(run.created_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
    const origin = run.channel === 'session' ? 'deliberación' : run.mode === 'debate' ? 'debate' : 'consulta';
    return `${when} · ${origin}${run.simulate ? ' · simulación' : ''}`;
  }

  tokensOf(agent: { input_tokens?: number; output_tokens?: number }): number {
    return (agent.input_tokens ?? 0) + (agent.output_tokens ?? 0);
  }
}
