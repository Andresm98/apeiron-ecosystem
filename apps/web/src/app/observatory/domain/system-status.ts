import type { GuardEvent } from '../../research/domain/chat.ts';
import type { RunSummary } from '../../research/domain/run-record.ts';

export type Health = 'ok' | 'degraded' | 'down' | 'disabled' | 'simulated';

export interface SystemComponent { id: string; label: string; status: Health; detail: string; }

/** Actividad del proceso de la API (por instancia, desde su arranque). Solo agregados. */
export interface RuntimeActivity {
  since: number;
  active_runs: number;
  runs: number;
  statuses: Record<string, number>;
  channels: Record<string, number>;
  guardrails: Record<string, number>; // "etapa:regla" -> intervenciones
  llm_calls: number;
  total_tokens: number;
  latency_ms: { p50: number | null; p95: number | null };
  failures: Record<string, number>;
  last_failure_at: Record<string, number>;
}

export interface A2ATaskSummary {
  id: string;
  context_id: string;
  state: string;
  question: string;
  created_at: number;
  updated_at: number;
}

export interface SystemStatus {
  service: { version: string; env: string; auth_provider: string; started_at: number; uptime_s: number };
  components: SystemComponent[];
  activity: RuntimeActivity;
  a2a: { server_enabled: boolean; card_url: string | null; tasks: Record<string, number>; my_tasks: A2ATaskSummary[] };
  limits: {
    chat_per_min: number;
    chat_remaining: number | null;
    max_rounds: number;
    max_react_steps: number;
    node_timeout_s: number;
    tool_timeout_s: number;
    require_evidence: boolean;
  };
}

export const HEALTH_LABEL: Record<Health, string> = {
  ok: 'Operativo',
  degraded: 'Degradado',
  down: 'Caído',
  disabled: 'Desactivado',
  simulated: 'Simulación',
};

/** El estado nunca se comunica solo con color: cada uno lleva su símbolo y su etiqueta. */
export const HEALTH_ICON: Record<Health, string> = { ok: '●', degraded: '◐', down: '✕', disabled: '○', simulated: '◇' };

/** Salud global: lo peor de los componentes activos (desactivado o simulado no penaliza). */
export function overallHealth(components: SystemComponent[]): 'ok' | 'degraded' | 'down' {
  if (components.some((c) => c.status === 'down')) return 'down';
  if (components.some((c) => c.status === 'degraded')) return 'degraded';
  return 'ok';
}

const TASK_STATES: Record<string, string> = {
  TASK_STATE_SUBMITTED: 'Recibida',
  TASK_STATE_WORKING: 'En curso',
  TASK_STATE_COMPLETED: 'Completada',
  TASK_STATE_REJECTED: 'Rechazada',
  TASK_STATE_FAILED: 'Fallida',
  TASK_STATE_CANCELED: 'Cancelada',
  TASK_STATE_INPUT_REQUIRED: 'Espera datos',
  TASK_STATE_AUTH_REQUIRED: 'Requiere auth',
};

export function taskStateLabel(state: string): string {
  return TASK_STATES[state] ?? state;
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** "turn:ungrounded_citation" -> {stage, rule, count}, de más a menos frecuente. */
export function guardrailCounts(counts: Record<string, number>): { stage: string; rule: string; count: number }[] {
  return Object.entries(counts)
    .map(([key, count]) => {
      const [stage = '', rule = key] = key.split(':');
      return { stage, rule, count };
    })
    .sort((a, b) => b.count - a.count);
}

export interface HistoryStats {
  total: number;
  completed: number;
  blocked: number;
  errors: number;
  simulated: number;
  a2a: number;
  tokens: number;
  avgDurationMs: number | null;
  guardrails: { rule: string; count: number }[];
}

/** Resumen de las ejecuciones propias persistidas (Supabase). */
export function historyStats(runs: RunSummary[]): HistoryStats {
  const counts = new Map<string, number>();
  const events: GuardEvent[] = runs.flatMap((r) => r.guardrails ?? []);
  for (const ev of events) for (const rule of ev.rules) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  const durations = runs.map((r) => r.duration_ms).filter((d) => d > 0);
  return {
    total: runs.length,
    completed: runs.filter((r) => r.status === 'completed').length,
    blocked: runs.filter((r) => r.status === 'blocked').length,
    errors: runs.filter((r) => r.status === 'error').length,
    simulated: runs.filter((r) => r.simulate).length,
    a2a: runs.filter((r) => r.channel === 'a2a').length,
    tokens: runs.reduce((sum, r) => sum + (r.usage.total_tokens ?? 0), 0),
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    guardrails: [...counts].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count),
  };
}

/** Ancho relativo de una barra (0–100) respecto al máximo de la serie. */
export function barWidth(count: number, max: number): number {
  return max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
}
