import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { AuthService } from '../../auth/application/auth.service';
import { SessionStore } from '../../auth/application/session.store';
import { ChatEvent, SessionEvent } from '../../research/domain/chat';
import { frameId, parseFrame } from '../../research/infrastructure/sse-frame.parser';
import { API_BASE_URL } from '../../shared/infrastructure/api.config';
import { DeliberationPort, TurnResult } from '../application/ports/deliberation.port';
import { DeliberationRequest } from '../domain/deliberation';
import { LinkStatus, OpenSession } from '../domain/hud';

const TERMINAL = new Set(['completed', 'cancelled', 'error']);
const MAX_RETRIES = 6;

function commandError(e: unknown): Error {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 409) return new Error('La sesión no admite esa orden ahora.');
    if (e.status === 429) return new Error('Ya tienes demasiadas sesiones activas o consultas seguidas.');
    if (e.status === 404) return new Error('La sesión ya no existe.');
    if (e.status === 422) return new Error('Los parámetros de la deliberación no son válidos.');
    return new Error(`La API respondió HTTP ${e.status}.`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** Sesiones deliberativas sobre HTTP; el stream es SSE sobre fetch (Authorization) y se reengancha solo. */
@Injectable()
export class HttpDeliberationAdapter extends DeliberationPort {
  private http = inject(HttpClient);
  private session = inject(SessionStore);
  private auth = inject(AuthService);
  private readonly base = `${API_BASE_URL}/v1/sessions`;

  async create(request: DeliberationRequest): Promise<SessionEvent> {
    try {
      return await firstValueFrom(this.http.post<SessionEvent>(this.base, request));
    } catch (e) {
      throw commandError(e);
    }
  }

  async list(): Promise<OpenSession[]> {
    try {
      return await firstValueFrom(this.http.get<OpenSession[]>(this.base));
    } catch (e) {
      throw commandError(e);
    }
  }

  async turn(sessionId: string, text: string): Promise<TurnResult> {
    try {
      return await firstValueFrom(this.http.post<TurnResult>(`${this.url(sessionId)}/turn`, { text }));
    } catch (e) {
      const detail = e instanceof HttpErrorResponse ? (e.error?.detail as { blocked?: boolean; rules?: string[] }) : null;
      if (detail?.blocked) return { accepted: false, rules: detail.rules ?? [] };
      throw commandError(e);
    }
  }

  advance(sessionId: string): Promise<void> {
    return this.command(`${this.url(sessionId)}/advance`, {});
  }

  invite(sessionId: string, agent: string): Promise<void> {
    return this.command(`${this.url(sessionId)}/invite`, { agent });
  }

  close(sessionId: string): Promise<void> {
    return this.command(`${this.url(sessionId)}/close`, {});
  }

  async cancel(sessionId: string): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(this.url(sessionId)));
    } catch (e) {
      throw commandError(e);
    }
  }

  events(sessionId: string, link: (status: LinkStatus) => void = () => undefined): Observable<ChatEvent> {
    return new Observable<ChatEvent>((sub) => {
      let last = 0;
      let finished = false;
      let stopped = false;
      let ctrl = new AbortController();

      const connect = async (): Promise<void> => {
        ctrl = new AbortController();
        const res = await fetch(`${this.url(sessionId)}/events?after=${last}`, {
          headers: { Authorization: `Bearer ${this.session.token()}` },
          signal: ctrl.signal,
        });
        if (res.status === 401) {
          this.auth.expire();
          throw Object.assign(new Error('Tu sesión expiró.'), { fatal: true });
        }
        if (res.status === 404) throw Object.assign(new Error('La sesión ya no existe.'), { fatal: true });
        if (!res.ok || !res.body) throw new Error(`La API respondió HTTP ${res.status}.`);
        link({ kind: 'online' });
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (; ;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const seq = frameId(frame);
            const ev = parseFrame(frame);
            if (seq !== null) last = seq;
            if (!ev) continue;
            if (ev.type === 'session' && TERMINAL.has(ev.data.status)) finished = true;
            sub.next(ev);
          }
        }
      };

      (async () => {
        for (let attempt = 0; !stopped; ) {
          try {
            const before = last;
            await connect();
            if (finished) {
              sub.complete();
              return;
            }
            attempt = last > before ? 0 : attempt + 1; // el servidor cerró antes del final: reengancharse
          } catch (e) {
            if (stopped) return;
            if ((e as { fatal?: boolean }).fatal || attempt >= MAX_RETRIES) {
              link({ kind: 'lost' });
              sub.error(e);
              return;
            }
            attempt += 1;
          }
          if (attempt > MAX_RETRIES) {
            link({ kind: 'lost' });
            sub.error(new Error('Se perdió la conexión con la sesión.'));
            return;
          }
          if (attempt) {
            link({ kind: 'retrying', attempt, max: MAX_RETRIES });
            await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** (attempt - 1), 8000)));
          }
        }
      })();

      return () => {
        stopped = true;
        ctrl.abort();
      };
    });
  }

  private url(sessionId: string): string {
    return `${this.base}/${encodeURIComponent(sessionId)}`;
  }

  private async command(url: string, body: object): Promise<void> {
    try {
      await firstValueFrom(this.http.post(url, body));
    } catch (e) {
      throw commandError(e);
    }
  }
}
