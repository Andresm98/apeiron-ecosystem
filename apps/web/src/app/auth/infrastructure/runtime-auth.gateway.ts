import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { API_BASE_URL } from '../../shared/infrastructure/api.config';
import { AuthGateway } from '../application/ports/auth.gateway';
import { AuthError } from '../domain/auth-error';
import { Credentials } from '../domain/credentials';
import { AuthCapabilities, AuthSession } from '../domain/session';
import { describeAuthError } from './http-auth-errors';
import { HttpAuthGateway } from './http-auth.gateway';
import { AuthConfigDto, SessionProvider } from './session-provider';

const CONFIG_TIMEOUT_MS = 5000;

/**
 * Elige el proveedor según `GET /v1/auth/config`: el mismo build sirve para Supabase o
 * modo local. El SDK de Supabase se carga en un chunk aparte solo si hace falta.
 */
@Injectable()
export class RuntimeAuthGateway extends AuthGateway {
  private http = inject(HttpClient);
  private provider: SessionProvider = inject(HttpAuthGateway);

  async init(): Promise<AuthCapabilities> {
    let cfg: AuthConfigDto;
    try {
      // Con la API caída, Nginx puede retener la petición: el login no debe quedar en blanco.
      cfg = await firstValueFrom(
        this.http.get<AuthConfigDto>(`${API_BASE_URL}/v1/auth/config`).pipe(timeout(CONFIG_TIMEOUT_MS)),
      );
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      throw new AuthError(describeAuthError(status, 'config'));
    }
    const useSupabase = cfg.provider === 'supabase' && !!cfg.supabase_url && !!cfg.supabase_key;
    if (useSupabase) {
      const [{ createClient }, { SupabaseAuthGateway }] = await Promise.all([
        import('@supabase/supabase-js'),
        import('./supabase-auth.gateway'),
      ]);
      this.provider = new SupabaseAuthGateway(
        createClient(cfg.supabase_url!, cfg.supabase_key!, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        }),
      );
    }
    return {
      provider: useSupabase ? 'supabase' : 'local',
      identifier: useSupabase ? 'email' : 'username',
      registrationOpen: cfg.public_register,
      runsEnabled: cfg.runs_enabled,
    };
  }

  restore(): Promise<AuthSession | null> {
    return this.provider.restore();
  }

  watch(listener: (session: AuthSession | null) => void): void {
    this.provider.watch(listener);
  }

  register(credentials: Credentials): Promise<AuthSession | null> {
    return this.provider.register(credentials);
  }

  signIn(credentials: Credentials): Promise<AuthSession> {
    return this.provider.signIn(credentials);
  }

  signOut(): Promise<void> {
    return this.provider.signOut();
  }
}
