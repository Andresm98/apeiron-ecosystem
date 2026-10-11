import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../auth/application/auth.service';
import { SessionStore } from '../../../auth/application/session.store';
import { AgentDirectory } from '../../application/agent-directory';
import { ResearchStore } from '../../application/research.store';
import { CASE_STUDIES, CaseStudy } from '../../domain/case-studies';
import { ChatRequest, Mode, Turn } from '../../domain/chat';
import { ConversationSummary, estimateCalls, toggleParticipant } from '../../domain/conversation';
import { excerpt, pendingSteps, repliedTurn, stepsOfTurn } from '../../domain/dialogue';
import { MarkdownComponent } from '../markdown/markdown.component';
import { RunInspectorComponent } from '../run-inspector/run-inspector.component';
import { TurnCardComponent } from '../turn-card/turn-card.component';

const NEAR_BOTTOM_PX = 160; // si el usuario subió a releer, la consola no le arrastra hacia abajo

@Component({
  selector: 'app-workspace-page',
  imports: [FormsModule, RouterLink, NgTemplateOutlet, MarkdownComponent, RunInspectorComponent, TurnCardComponent],
  templateUrl: './workspace.page.html',
  styleUrl: './workspace.page.scss',
})
export class WorkspacePage implements OnInit {
  private auth = inject(AuthService);
  readonly session = inject(SessionStore);
  readonly state = inject(ResearchStore);
  readonly caseStudies = CASE_STUDIES;
  readonly suggestions = CASE_STUDIES.slice(0, 4);
  readonly agentLabel = inject(AgentDirectory).label;
  readonly excerpt = excerpt;
  readonly stepsOfTurn = stepsOfTurn;
  readonly repliedTo = (turns: Turn[], index: number) => repliedTurn(turns, index);
  readonly liveSteps = computed(() => pendingSteps(this.state.steps(), this.state.turns()));
  readonly historyEnabled = computed(() => this.session.capabilities().runsEnabled);
  /** Pestaña elegida; sin elegir, las conversaciones si hay historial y si no los casos. */
  readonly leftTab = signal<'cases' | 'history' | null>(null);
  readonly tab = computed(() => this.leftTab() ?? (this.historyEnabled() ? 'history' : 'cases'));

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly questionBox = viewChild<ElementRef<HTMLTextAreaElement>>('questionBox');

  question = '';
  readonly mode = signal<Mode>('single');
  readonly agent = signal<string | null>(null);
  readonly rounds = signal(1);
  readonly simulate = signal(true); // por defecto 0 tokens: ver la arquitectura sin coste
  /** Mesa elegida por el usuario; null = la mesa por defecto de la topología. */
  private readonly chosenTable = signal<string[] | null>(null);

  readonly agents = computed(() => this.state.topology()?.agents ?? []);
  readonly model = computed(() => this.state.topology()?.llm.model ?? 'LLM configurado');
  readonly agentNames = computed(
    () => this.agents().map((a) => this.agentLabel(a.name)).join(' · ') || 'cargando agentes…',
  );
  readonly maxSeats = computed(() => Math.min(this.state.topology()?.limits.max_participants ?? 6, this.agents().length));
  readonly roundOptions = computed(() => {
    const max = this.state.topology()?.limits.max_rounds ?? 4;
    return Array.from({ length: max }, (_, i) => i + 1);
  });
  readonly table = computed(() => {
    const known = new Set(this.agents().map((a) => a.name));
    const table = this.chosenTable() ?? this.state.topology()?.debate_participants ?? [];
    return table.filter((name) => known.has(name));
  });

  readonly threadTitle = computed(() => {
    const first = this.state.thread()[0]?.question;
    return first ? excerpt(first, 90) : 'Pregunta al Ápeiron';
  });

  readonly planLabel = computed(() => {
    if (this.mode() === 'single') {
      const agent = this.agent();
      return agent ? `Consulta a ${this.agentLabel(agent)}` : 'Ápeiron elige al pensador';
    }
    const table = this.table();
    if (table.length < 2) return 'Elige al menos dos pensadores para la mesa';
    const rounds = this.rounds();
    return `${table.map((n) => this.agentLabel(n)).join(' → ')} · ${rounds} ${rounds === 1 ? 'ronda' : 'rondas'} · síntesis`;
  });

  constructor() {
    // El historial se carga en cuanto se sabe que existe (la sesión puede resolverse después de la ruta).
    effect(() => {
      if (this.historyEnabled()) untracked(() => void this.state.loadHistory());
    });
    // Sigue la conversación al pie mientras llegan turnos, salvo que el usuario haya subido a releer.
    effect(() => {
      const exchanges = this.state.thread().length;
      this.state.turns();
      this.state.steps();
      this.state.answer();
      untracked(() => this.followBottom(exchanges));
    });
  }

  private lastExchanges = 0;

  private followBottom(exchanges: number): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    const newExchange = exchanges !== this.lastExchanges;
    this.lastExchanges = exchanges;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    // Salto inmediato: un desplazamiento suave se queda a medias si llega otro turno durante la animación.
    if (newExchange || near) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
  }

  ngOnInit(): void {
    void this.state.loadTopology();
  }

  isRemote(agent: string): boolean {
    return this.agents().some((a) => a.name === agent && a.kind === 'remote');
  }

  /** Puesto en la mesa (1 = abre el debate); 0 si no está sentado. */
  seat(name: string): number {
    return this.table().indexOf(name) + 1;
  }

  toggleSeat(name: string): void {
    this.chosenTable.set(toggleParticipant(this.table(), name, this.maxSeats()));
  }

  speakers(turns: Turn[]): string {
    return [...new Set(turns.map((t) => this.agentLabel(t.agent)))].join(', ');
  }

  isActive(c: ConversationSummary): boolean {
    return c.legacy ? this.state.openedRunId() === c.id && !this.state.conversationId() : this.state.conversationId() === c.id;
  }

  showHistory(): void {
    this.leftTab.set('history');
    void this.state.loadHistory();
  }

  async openConversation(c: ConversationSummary): Promise<void> {
    if (this.state.status() === 'running') return;
    const ok = c.legacy ? (await this.state.openRun(c.id)) !== null : await this.state.openConversation(c.id);
    if (ok) this.question = '';
  }

  runDate(iso: string): string {
    return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  selectCase(caseStudy: CaseStudy): void {
    this.question = caseStudy.prompt;
    this.mode.set(caseStudy.mode);
    this.questionBox()?.nativeElement.focus();
  }

  newConversation(): void {
    if (this.state.status() === 'running') return;
    this.state.newConversation();
    this.question = '';
    this.questionBox()?.nativeElement.focus();
  }

  canSend(): boolean {
    if (!this.question.trim() || this.state.status() === 'running') return false;
    return this.mode() === 'single' || this.table().length >= 2;
  }

  sendHint(): string | null {
    return this.mode() === 'debate' && this.table().length < 2 ? 'Elige al menos dos pensadores' : null;
  }

  /** Intro envía; Mayús+Intro (o una composición de IME en curso) escribe un salto de línea. */
  onEnter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey || key.isComposing) return;
    key.preventDefault();
    this.submitQuestion();
  }

  submitQuestion(): void {
    if (!this.canSend()) return;
    const question = this.question.trim();
    const mode = this.mode();
    const request: ChatRequest = { question, mode, simulate: this.simulate() };
    if (mode === 'single') {
      const agent = this.agent();
      if (agent) request.agent = agent;
    } else {
      request.participants = this.table();
      request.max_rounds = this.rounds();
    }
    this.state.ask(request, mode);
    this.question = '';
  }

  estimate(): string {
    return estimateCalls(this.mode(), this.table().length, this.rounds());
  }

  cancel(): void {
    this.state.cancel();
  }

  logout(): void {
    this.state.clear();
    this.auth.signOut();
  }
}
