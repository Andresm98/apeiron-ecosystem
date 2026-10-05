import { Injectable, computed, inject, signal } from '@angular/core';
import { RunHistoryRepository } from '../../research/application/ports/run-history.repository';
import { TopologyRepository } from '../../research/application/ports/topology.repository';
import { Topology } from '../../research/domain/topology';
import { HistoryStats, SystemStatus, historyStats, overallHealth } from '../domain/system-status';
import { SystemStatusRepository } from './ports/system-status.repository';

const REFRESH_MS = 10_000;
const HISTORY_SAMPLE = 100;

/** Panel de sistema: componentes, actividad del proceso, A2A y la actividad propia. */
@Injectable()
export class ObservatoryStore {
  private systems = inject(SystemStatusRepository);
  private runs = inject(RunHistoryRepository);
  private topologies = inject(TopologyRepository);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly status = signal<SystemStatus | null>(null);
  readonly error = signal('');
  readonly updatedAt = signal<Date | null>(null);
  readonly history = signal<HistoryStats | null>(null);
  readonly historyError = signal('');
  readonly auto = signal(true);
  readonly topology = signal<Topology | null>(null);
  readonly health = computed(() => {
    const status = this.status();
    return status ? overallHealth(status.components) : null;
  });

  async refresh(withHistory: boolean): Promise<void> {
    try {
      this.status.set(await this.systems.load());
      this.error.set('');
      this.updatedAt.set(new Date());
    } catch {
      this.error.set('No se pudo consultar el estado del sistema.');
    }
    if (!withHistory) return;
    try {
      this.history.set(historyStats(await this.runs.list(HISTORY_SAMPLE)));
      this.historyError.set('');
    } catch {
      this.historyError.set('No se pudo leer tu historial.');
    }
  }

  /** Refresco periódico mientras la vista está abierta (sin coste de LLM: solo lecturas). */
  start(withHistory: boolean): void {
    void this.refresh(withHistory);
    this.topologies.load().then((t) => this.topology.set(t), () => this.topology.set(null));
    this.stop();
    this.timer = setInterval(() => {
      if (this.auto()) void this.refresh(withHistory);
    }, REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
