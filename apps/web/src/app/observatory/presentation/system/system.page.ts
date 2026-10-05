import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../auth/application/auth.service';
import { SessionStore } from '../../../auth/application/session.store';
import { GUARDRAIL_STAGES, ruleLabel } from '../../../research/domain/guardrails';
import { agentLabel } from '../../../research/presentation/agent-label';
import { ObservatoryStore } from '../../application/observatory.store';
import {
  HEALTH_ICON, HEALTH_LABEL, Health, barWidth, formatUptime, guardrailCounts, taskStateLabel,
} from '../../domain/system-status';

/** Observatorio: qué está pasando en el sistema (componentes, actividad, agentes, A2A y límites). */
@Component({
  selector: 'app-system-page',
  imports: [RouterLink],
  templateUrl: './system.page.html',
  styleUrl: './system.page.scss',
})
export class SystemPage implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  readonly session = inject(SessionStore);
  readonly store = inject(ObservatoryStore);
  readonly historyEnabled = computed(() => this.session.capabilities().runsEnabled);

  readonly healthLabel = HEALTH_LABEL;
  readonly healthIcon = HEALTH_ICON;
  readonly stageLabel = GUARDRAIL_STAGES as Record<string, string>;
  readonly ruleLabel = ruleLabel;
  readonly taskStateLabel = taskStateLabel;
  readonly agentLabel = agentLabel;
  readonly uptime = formatUptime;
  readonly barWidth = barWidth;

  readonly activity = computed(() => this.store.status()?.activity ?? null);
  readonly guardrails = computed(() => guardrailCounts(this.activity()?.guardrails ?? {}));
  readonly guardrailMax = computed(() => Math.max(0, ...this.guardrails().map((g) => g.count)));
  readonly historyRulesMax = computed(() => Math.max(0, ...(this.store.history()?.guardrails ?? []).map((g) => g.count)));
  readonly a2aTasks = computed(() => Object.entries(this.store.status()?.a2a.tasks ?? {}));
  readonly failures = computed(() => Object.entries(this.activity()?.failures ?? {}));

  ngOnInit(): void {
    this.store.start(this.historyEnabled());
  }

  ngOnDestroy(): void {
    this.store.stop();
  }

  refresh(): void {
    void this.store.refresh(this.historyEnabled());
  }

  toggleAuto(): void {
    this.store.auto.update((on) => !on);
  }

  count(record: Record<string, number> | undefined, key: string): number {
    return record?.[key] ?? 0;
  }

  status(health: Health | 'ok' | 'degraded' | 'down'): string {
    return `health health-${health}`;
  }

  time(epochSeconds: number): string {
    return new Date(epochSeconds * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  seconds(ms: number | null | undefined): string {
    return ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`;
  }

  logout(): void {
    this.store.stop();
    this.auth.signOut();
  }
}
