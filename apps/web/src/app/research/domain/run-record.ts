import type { Turn, Usage } from './chat.ts';

/** Resumen de una ejecución persistida (lista del historial). */
export interface RunSummary {
  id: string;
  created_at: string;
  question: string;
  mode: string;
  simulate: boolean;
  status: 'completed' | 'error';
  usage: Partial<Usage>;
  model: string;
  duration_ms: number;
}

/** Ejecución completa: lo necesario para reabrirla en la consola. */
export interface RunRecord extends RunSummary {
  trace_id: string;
  answer: string;
  turns: Turn[];
  trace: string[];
  error: string | null;
}
