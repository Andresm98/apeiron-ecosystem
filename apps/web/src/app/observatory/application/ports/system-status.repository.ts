import type { SystemStatus } from '../../domain/system-status.ts';

/** Puerto de salida: estado del sistema publicado por la API (`GET /v1/system`). */
export abstract class SystemStatusRepository {
  abstract load(): Promise<SystemStatus>;
}
