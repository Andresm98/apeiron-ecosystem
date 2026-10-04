import { Injectable, inject } from '@angular/core';
import { Credentials } from '../domain/credentials';
import { SignUpResult } from '../domain/session';
import { AuthGateway } from './ports/auth.gateway';
import { SessionStore } from './session.store';

/** Casos de uso de acceso: orquesta el gateway y el estado de sesión. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private gateway = inject(AuthGateway);
  private session = inject(SessionStore);

  /** Arranque: descubre el proveedor y restaura la sesión persistida antes de enrutar. */
  async init(): Promise<void> {
    try {
      this.session.capabilities.set(await this.gateway.init());
      const restored = await this.gateway.restore();
      if (restored) this.session.open(restored);
      this.gateway.watch((session) => this.session.sync(session));
    } catch {
      // Sin API/proveedor: el login mostrará el error concreto al enviar.
    }
  }

  async signIn(credentials: Credentials): Promise<void> {
    this.session.open(await this.gateway.signIn(credentials));
  }

  async signUp(credentials: Credentials): Promise<SignUpResult> {
    const session = await this.gateway.register(credentials);
    if (!session) return 'confirm-email';
    this.session.open(session);
    return 'signed-in';
  }

  signOut(notice = ''): void {
    this.session.close(notice);
    void this.gateway.signOut();
  }

  /** El backend rechazó el token (401): cierra también la sesión persistida del proveedor. */
  expire(): void {
    this.signOut('Tu sesión expiró. Vuelve a iniciar sesión para continuar.');
  }
}
