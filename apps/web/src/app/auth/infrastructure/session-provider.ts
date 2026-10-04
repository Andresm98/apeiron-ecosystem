import type { Credentials } from '../domain/credentials.ts';
import type { AuthSession } from '../domain/session.ts';

/** Contrato interno de los adaptadores concretos que `RuntimeAuthGateway` elige al arrancar. */
export interface SessionProvider {
  restore(): Promise<AuthSession | null>;
  watch(listener: (session: AuthSession | null) => void): void;
  register(credentials: Credentials): Promise<AuthSession | null>;
  signIn(credentials: Credentials): Promise<AuthSession>;
  signOut(): Promise<void>;
}

/** Configuración pública que expone `GET /v1/auth/config`. */
export interface AuthConfigDto {
  provider: 'local' | 'supabase';
  public_register: boolean;
  runs_enabled: boolean;
  supabase_url?: string;
  supabase_key?: string;
}
