import type { Observable } from 'rxjs';
import type { ChatEvent, SessionEvent } from '../../../research/domain/chat.ts';
import type { DeliberationRequest } from '../../domain/deliberation.ts';
import type { LinkStatus, OpenSession } from '../../domain/hud.ts';

/** Resultado de enviar el turno de ssanax: el guardrail de entrada puede rechazarlo (ADR-011). */
export type TurnResult = { accepted: true; redacted?: boolean } | { accepted: false; rules: string[] };

/** Puerto de salida: sesiones deliberativas de la API (`/v1/sessions`, ADR-013 fase 2). */
export abstract class DeliberationPort {
  abstract create(request: DeliberationRequest): Promise<SessionEvent>;
  /** Sesiones abiertas del usuario, incluidas las dormidas tras un reinicio de la API (`GET /v1/sessions`). */
  abstract list(): Promise<OpenSession[]>;
  /**
   * Eventos de la sesión desde el principio; el adaptador se reengancha solo con `after=N` si se corta la conexión
   * y lo cuenta por `link` para que la UI muestre «Reconectando… intento 2/6».
   */
  abstract events(sessionId: string, link?: (status: LinkStatus) => void): Observable<ChatEvent>;
  abstract turn(sessionId: string, text: string): Promise<TurnResult>;
  abstract advance(sessionId: string): Promise<void>;
  abstract invite(sessionId: string, agent: string): Promise<void>;
  abstract close(sessionId: string): Promise<void>;
  abstract cancel(sessionId: string): Promise<void>;
}
