import { Injectable, computed, signal } from '@angular/core';
import { tokenExpiry } from '../domain/access-token';
import { AuthCapabilities, AuthSession, LOCAL_CAPABILITIES } from '../domain/session';

/**
 * Estado de sesión. Con Supabase la sesión persiste entre recargas y el proveedor renueva
 * el token; en modo local el JWT vive solo en memoria y caduca con su `exp`.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private expiryTimer?: ReturnType<typeof setTimeout>;

  readonly capabilities = signal<AuthCapabilities>(LOCAL_CAPABILITIES);
  readonly token = signal<string | null>(null);
  readonly username = signal<string | null>(null);
  readonly persistent = signal(false);
  readonly notice = signal(''); // aviso para la pantalla de login (p. ej. sesión expirada)
  readonly isAuthenticated = computed(() => this.token() !== null);

  open(session: AuthSession): void {
    this.token.set(session.token);
    this.username.set(session.username);
    this.persistent.set(session.persistent);
    this.notice.set('');
    if (session.persistent) clearTimeout(this.expiryTimer);
    else this.scheduleExpiry(session.token);
  }

  /** Aplica un cambio emitido por el proveedor (renovación o cierre externo). */
  sync(session: AuthSession | null): void {
    if (session) this.open(session);
    else if (this.isAuthenticated()) this.close();
  }

  close(notice = ''): void {
    clearTimeout(this.expiryTimer);
    this.token.set(null);
    this.username.set(null);
    this.persistent.set(false);
    this.notice.set(notice);
  }

  expire(): void {
    this.close('Tu sesión expiró. Vuelve a iniciar sesión para continuar.');
  }

  private scheduleExpiry(token: string): void {
    clearTimeout(this.expiryTimer);
    const exp = tokenExpiry(token);
    if (exp === null) return;
    const ms = exp * 1000 - Date.now();
    this.expiryTimer = setTimeout(() => this.expire(), Math.max(ms, 0));
  }
}
