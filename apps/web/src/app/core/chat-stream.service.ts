import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { AuthService } from './auth.service';
import { ChatEvent, ChatRequest } from './models';

import { parseFrame } from './parser';

@Injectable({ providedIn: 'root' })
export class ChatStreamService {
  private auth = inject(AuthService);

  /** SSE sobre fetch: soporta POST + Authorization. Cancelar = unsubscribe. */
  stream(req: ChatRequest): Observable<ChatEvent> {
    return new Observable<ChatEvent>((sub) => {
      const ctrl = new AbortController();
      (async () => {
        const res = await fetch(`${API_BASE_URL}/v1/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.auth.token()}` },
          body: JSON.stringify(req),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
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
      })().catch((e) => sub.error(e));
      return () => ctrl.abort();
    });
  }
}
