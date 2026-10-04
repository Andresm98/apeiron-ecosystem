export interface Credentials { username: string; password: string; }

export interface CredentialsInput extends Credentials { confirm?: string; }

export type Identifier = 'username' | 'email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validación alineada con el proveedor (usuario local o correo en Supabase); null si es válido. */
export function validateCredentials(
  input: CredentialsInput,
  register: boolean,
  identifier: Identifier = 'username',
): string | null {
  const id = input.username.trim();
  if (identifier === 'email' && !EMAIL_RE.test(id)) return 'Escribe un correo válido.';
  if (identifier === 'username' && (id.length < 3 || id.length > 64)) return 'El usuario debe tener entre 3 y 64 caracteres.';
  if (input.password.length < 8 || input.password.length > 72) return 'La contraseña debe tener entre 8 y 72 caracteres.';
  if (register && input.password !== input.confirm) return 'Las contraseñas no coinciden.';
  return null;
}
