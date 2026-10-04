import type { RunRecord, RunSummary } from '../../domain/run-record.ts';

/** Puerto de salida: ejecuciones persistidas del usuario (Supabase vía API). */
export abstract class RunHistoryRepository {
  abstract list(limit?: number): Promise<RunSummary[]>;
  abstract get(id: string): Promise<RunRecord>;
}
