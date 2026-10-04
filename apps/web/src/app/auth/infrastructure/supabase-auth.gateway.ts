import type { AuthError as SupabaseAuthError, Session, SupabaseClient } from '@supabase/supabase-js';
import { AuthAction, AuthError } from '../domain/auth-error';
import { Credentials } from '../domain/credentials';
import { AuthSession } from '../domain/session';
import { SessionProvider } from './session-provider';
import { describeSupabaseError } from './supabase-auth-errors';

function toSession(session: Session | null): AuthSession | null {
  if (!session) return null;
  return { token: session.access_token, username: session.user.email ?? session.user.id, persistent: true };
}

function fail(error: SupabaseAuthError, action: AuthAction): never {
  throw new AuthError(describeSupabaseError(error.code, error.status, action));
}

/**
 * Supabase Auth: el SDK persiste la sesión en el navegador, renueva el access token antes
 * de que caduque y notifica cambios (también desde otras pestañas).
 */
export class SupabaseAuthGateway implements SessionProvider {
  constructor(private readonly client: SupabaseClient) {}

  async restore(): Promise<AuthSession | null> {
    const { data } = await this.client.auth.getSession();
    return toSession(data.session);
  }

  watch(listener: (session: AuthSession | null) => void): void {
    this.client.auth.onAuthStateChange((_event, session) => listener(toSession(session)));
  }

  async register({ username, password }: Credentials): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.signUp({ email: username, password });
    if (error) fail(error, 'register');
    return toSession(data.session); // null: el proyecto exige confirmar el correo
  }

  async signIn({ username, password }: Credentials): Promise<AuthSession> {
    const { data, error } = await this.client.auth.signInWithPassword({ email: username, password });
    if (error) fail(error, 'login');
    const session = toSession(data.session);
    if (!session) throw new AuthError('Supabase no devolvió una sesión.');
    return session;
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut({ scope: 'local' });
  }
}
