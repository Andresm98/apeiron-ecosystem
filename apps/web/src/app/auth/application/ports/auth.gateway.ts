import type { Credentials } from '../../domain/credentials.ts';
import type { AuthCapabilities, AuthSession } from '../../domain/session.ts';

/**
 * Puerto de salida hacia el proveedor de identidad (API local o Supabase Auth).
 * Las implementaciones lanzan `AuthError` con un mensaje ya traducido.
 */
export abstract class AuthGateway {
  /** Descubre el proveedor configurado; se llama una vez al arrancar. */
  abstract init(): Promise<AuthCapabilities>;
  /** Sesión persistida de una visita anterior, si existe y sigue siendo válida. */
  abstract restore(): Promise<AuthSession | null>;
  /** Cambios iniciados por el proveedor: token renovado, logout en otra pestaña, refresh fallido. */
  abstract watch(listener: (session: AuthSession | null) => void): void;
  /** Devuelve la sesión, o null si el proveedor exige confirmar el correo antes de entrar. */
  abstract register(credentials: Credentials): Promise<AuthSession | null>;
  abstract signIn(credentials: Credentials): Promise<AuthSession>;
  abstract signOut(): Promise<void>;
}
