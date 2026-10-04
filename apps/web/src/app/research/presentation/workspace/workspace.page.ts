import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../auth/application/auth.service';
import { SessionStore } from '../../../auth/application/session.store';
import { ResearchStore } from '../../application/research.store';
import { CASE_STUDIES, CaseStudy } from '../../domain/case-studies';
import { Mode } from '../../domain/chat';
import { RunSummary } from '../../domain/run-record';
import { AgentGraphComponent } from '../agent-graph/agent-graph.component';
import { agentLabel } from '../agent-label';

@Component({
  selector: 'app-workspace-page',
  imports: [FormsModule, AgentGraphComponent],
  templateUrl: './workspace.page.html',
  styleUrl: './workspace.page.scss',
})
export class WorkspacePage implements OnInit {
  private auth = inject(AuthService);
  readonly session = inject(SessionStore);
  readonly state = inject(ResearchStore);
  readonly caseStudies = CASE_STUDIES;
  readonly selectedCaseId = signal(CASE_STUDIES[0]?.id ?? 1);
  readonly submittedQuestion = signal('');
  readonly agentLabel = agentLabel;
  readonly leftTab = signal<'cases' | 'history'>('cases');
  readonly historyEnabled = computed(() => this.session.capabilities().runsEnabled);

  question = CASE_STUDIES[0]?.prompt ?? '';
  mode: Mode = CASE_STUDIES[0]?.mode ?? 'single';
  rounds = 1;
  simulate = true; // por defecto 0 tokens: ver la arquitectura sin coste

  readonly model = computed(() => this.state.topology()?.llm.model ?? 'LLM configurado');
  readonly agentNames = computed(
    () => this.state.topology()?.agents.map((a) => agentLabel(a.name)).join(' · ') ?? 'Anaximandro · Heráclito',
  );

  ngOnInit(): void {
    void this.state.loadTopology();
  }

  showHistory(): void {
    this.leftTab.set('history');
    void this.state.loadHistory();
  }

  async openRun(run: RunSummary): Promise<void> {
    if (this.state.status() === 'running') return;
    const question = await this.state.openRun(run.id);
    if (question === null) return;
    this.submittedQuestion.set(question);
    this.question = question;
    if (run.mode === 'single' || run.mode === 'debate') this.mode = run.mode;
  }

  runDate(iso: string): string {
    return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  selectCase(caseStudy: CaseStudy): void {
    this.selectedCaseId.set(caseStudy.id);
    this.question = caseStudy.prompt;
    this.mode = caseStudy.mode;
  }

  submitQuestion(): void {
    const question = this.question.trim();
    if (!question || this.state.status() === 'running') return;
    this.submittedQuestion.set(question);
    this.state.run({
      question,
      mode: this.mode,
      max_rounds: this.mode === 'debate' ? this.rounds : undefined,
      simulate: this.simulate,
    });
  }

  /** Llamadas LLM aproximadas antes de enviar (orientativo; ReAct puede añadir pasos). */
  estimate(): string {
    if (this.mode === 'single') return '≈1–2 llamadas';
    const workers = this.state.topology()?.debate_participants.length ?? 2;
    return `≈${workers * this.rounds + 1}+ llamadas`;
  }

  cancel(): void {
    this.state.cancel();
  }

  logout(): void {
    this.state.clear();
    this.submittedQuestion.set('');
    this.auth.signOut();
  }
}
