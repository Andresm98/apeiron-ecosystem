import { Injectable, inject } from '@angular/core';
import { AuthError } from '../domain/auth-error';
import { Credentials } from '../domain/credentials';
import { SignUpResult } from '../domain/session';
import { AuthGateway } from './ports/auth.gateway';
import { SessionStore } from './session.store';

/** Casos de uso de acceso: orquesta el gateway y el estado de sesión. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private gateway = inject(AuthGateway);
  private session = inject(SessionStore);
  private discovered: Promise<void> | null = null;
  private retryTimer?: ReturnType<typeof setTimeout>;

  /**
   * Arranque: descubre el proveedor y restaura la sesión persistida antes de enrutar.
   * Si la API aún no responde (p. ej. arrancando), NO se asume modo local: se reintenta en
   * segundo plano y el login no envía credenciales hasta conocer el proveedor real.
   */
  async init(): Promise<void> {
    try {
      await this.discover();
    } catch {
      this.scheduleRetry(1);
    }
  }

  async signIn(credentials: Credentials): Promise<void> {
    await this.ready();
    this.session.open(await this.gateway.signIn(credentials));
  }

  async signUp(credentials: Credentials): Promise<SignUpResult> {
    await this.ready();
    const session = await this.gateway.register(credentials);
    if (!session) return 'confirm-email';
    this.session.open(session);
    return 'signed-in';
  }

  signOut(notice = ''): void {
    this.session.close(notice);
    void this.gateway.signOut();
  }

  /** Descubre el proveedor una sola vez; un fallo permite volver a intentarlo. */
  private discover(): Promise<void> {
    this.discovered ??= (async () => {
      this.session.capabilities.set(await this.gateway.init());
      if (this.session.notice().startsWith('La API')) this.session.notice.set('');
      const restored = await this.gateway.restore();
      if (restored) this.session.open(restored);
      this.gateway.watch((session) => this.session.sync(session));
    })().catch((error: unknown) => {
      this.discovered = null;
      throw error;
    });
    return this.discovered;
  }

  /** Antes de enviar credenciales: el proveedor debe ser el confirmado por la API. */
  private async ready(): Promise<void> {
    try {
      await this.discover();
    } catch (error) {
      throw error instanceof AuthError ? error : new AuthError('No hay conexión con la API.');
    }
  }

  private scheduleRetry(attempt: number): void {
    clearTimeout(this.retryTimer);
    if (attempt > 10) {
      this.session.notice.set('La API no responde. Comprueba que el backend está levantado y recarga la página.');
      return;
    }
    this.session.notice.set('La API aún no responde (puede estar arrancando). Reintentando…');
    this.retryTimer = setTimeout(() => {
      this.discover().catch(() => this.scheduleRetry(attempt + 1));
    }, Math.min(1000 * 2 ** (attempt - 1), 8000));
  }

  /** El backend rechazó el token (401): cierra también la sesión persistida del proveedor. */
  expire(): void {
    this.signOut('Tu sesión expiró. Vuelve a iniciar sesión para continuar.');
  }
}
