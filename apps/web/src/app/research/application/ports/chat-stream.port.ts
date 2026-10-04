import type { Observable } from 'rxjs';
import type { ChatEvent, ChatRequest } from '../../domain/chat.ts';

/** Puerto de salida: ejecuta una consulta y emite sus eventos. Cancelar = unsubscribe. */
export abstract class ChatStreamPort {
  abstract stream(request: ChatRequest): Observable<ChatEvent>;
}
