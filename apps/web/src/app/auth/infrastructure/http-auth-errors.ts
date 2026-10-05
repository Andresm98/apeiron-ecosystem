import type { AuthAction } from '../domain/auth-error.ts';

/** Traduce el status HTTP de /v1/auth/* a un mensaje para la persona usuaria. */
export function describeAuthError(status: number, action: AuthAction): string {
  // Sin configuración no se sabe si el acceso es por Supabase o local: no se adivina.
  if (action === 'config' && (status === 0 || status >= 502)) {
    return 'La API aún no responde (puede estar arrancando). Reintentando…';
  }
  if (status === 0) return 'No hay conexión con la API. Comprueba que el backend está levantado.';
  if (status === 401) return 'Usuario o contraseña incorrectos.';
  if (status === 403) return 'El registro público está deshabilitado. Pide una cuenta a quien administra.';
  if (status === 409) return 'Ese usuario ya existe. Elige otro nombre o inicia sesión.';
  if (status === 422) return 'Revisa los datos: usuario de 3 a 64 caracteres y contraseña de 8 a 72.';
  if (status === 429) return 'Demasiados intentos. Espera un minuto antes de volver a probar.';
  if (status >= 500) return 'La API tuvo un error interno. Inténtalo de nuevo en unos segundos.';
  return action === 'register' ? 'No se pudo crear la cuenta.' : 'No se pudo iniciar sesión.';
}
