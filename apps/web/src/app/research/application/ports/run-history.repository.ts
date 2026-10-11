import type { RunRecord, RunSummary } from '../../domain/run-record.ts';

/** Puerto de salida: ejecuciones persistidas del usuario (Supabase vía API). */
export abstract class RunHistoryRepository {
  abstract list(limit?: number): Promise<RunSummary[]>;
  abstract get(id: string): Promise<RunRecord>;
  /** Ejecuciones de una conversación de la consola, en orden (ADR-014). */
  abstract conversation(id: string): Promise<RunRecord[]>;
}
