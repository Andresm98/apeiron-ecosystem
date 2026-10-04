import type { AuthAction } from '../domain/auth-error.ts';

/** Traduce errores de Supabase Auth (`error.code` / `error.status`) a mensajes accionables. */
export function describeSupabaseError(code: string | undefined, status: number | undefined, action: AuthAction): string {
  switch (code) {
    case 'invalid_credentials': return 'Correo o contraseña incorrectos.';
    case 'email_not_confirmed': return 'Confirma tu correo: abre el enlace que te enviamos y vuelve a entrar.';
    case 'user_already_exists':
    case 'email_exists': return 'Ya existe una cuenta con ese correo. Inicia sesión.';
    case 'weak_password': return 'La contraseña es demasiado débil según la política del proyecto.';
    case 'signup_disabled': return 'El registro está deshabilitado en este proyecto.';
    case 'email_address_invalid': return 'Supabase no acepta ese correo. Usa una dirección real.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit': return 'Demasiados intentos. Espera un minuto antes de volver a probar.';
  }
  if (status === 429) return 'Demasiados intentos. Espera un minuto antes de volver a probar.';
  if (!status) return 'No hay conexión con Supabase. Revisa tu red o la URL del proyecto.';
  return action === 'register' ? 'No se pudo crear la cuenta.' : 'No se pudo iniciar sesión.';
}
