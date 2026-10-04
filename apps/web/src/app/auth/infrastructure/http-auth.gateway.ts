import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../shared/infrastructure/api.config';
import { AuthAction, AuthError } from '../domain/auth-error';
import { Credentials } from '../domain/credentials';
import { AuthSession } from '../domain/session';
import { describeAuthError } from './http-auth-errors';
import { SessionProvider } from './session-provider';

/** Modo local: /v1/auth/* de la API (SQLite + JWT propio, sesión solo en memoria). */
@Injectable({ providedIn: 'root' })
export class HttpAuthGateway implements SessionProvider {
  private http = inject(HttpClient);

  async restore(): Promise<AuthSession | null> {
    return null; // el JWT local no se persiste
  }

  watch(): void {
    // sin eventos externos: la caducidad la gestiona SessionStore con el `exp`
  }

  async register(credentials: Credentials): Promise<AuthSession> {
    const { username, password } = credentials;
    await this.call('register', this.http.post(`${API_BASE_URL}/v1/auth/register`, { username, password }));
    return this.signIn(credentials);
  }

  async signIn({ username, password }: Credentials): Promise<AuthSession> {
    const body = new HttpParams().set('username', username).set('password', password);
    const res = await this.call(
      'login',
      this.http.post<{ access_token: string }>(`${API_BASE_URL}/v1/auth/token`, body),
    );
    return { token: res.access_token, username, persistent: false };
  }

  async signOut(): Promise<void> {
    // nada que revocar en el servidor
  }

  private async call<T>(action: AuthAction, request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      throw new AuthError(describeAuthError(status, action));
    }
  }
}
