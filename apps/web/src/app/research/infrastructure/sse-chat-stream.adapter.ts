import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AuthService } from '../../auth/application/auth.service';
import { SessionStore } from '../../auth/application/session.store';
import { API_BASE_URL } from '../../shared/infrastructure/api.config';
import { ChatStreamPort } from '../application/ports/chat-stream.port';
import { ChatEvent, ChatRequest } from '../domain/chat';
import { parseFrame } from './sse-frame.parser';

function streamError(status: number): string {
  if (status === 429) return 'Demasiadas consultas seguidas; espera un minuto.';
  if (status === 422) return 'La pregunta o los parámetros no son válidos.';
  return `La API respondió HTTP ${status}.`;
}

/** SSE sobre fetch: soporta POST + Authorization, que EventSource no permite. */
@Injectable()
export class SseChatStreamAdapter extends ChatStreamPort {
  private session = inject(SessionStore);
  private auth = inject(AuthService);

  stream(req: ChatRequest): Observable<ChatEvent> {
    return new Observable<ChatEvent>((sub) => {
      const ctrl = new AbortController();
      (async () => {
        const res = await fetch(`${API_BASE_URL}/v1/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.session.token()}` },
          body: JSON.stringify(req),
          signal: ctrl.signal,
        });
        if (res.status === 401) {
          this.auth.expire(); // cierra también la sesión de Supabase; el guard redirige a /login
          throw new Error('Tu sesión expiró.');
        }
        if (!res.ok || !res.body) throw new Error(streamError(res.status));
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (; ;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const ev = parseFrame(buf.slice(0, i));
            buf = buf.slice(i + 2);
            if (ev) sub.next(ev);
          }
        }
        sub.complete();
      })().catch((e: unknown) => {
        if (!ctrl.signal.aborted) sub.error(e);
      });
      return () => ctrl.abort();
    });
  }
}
