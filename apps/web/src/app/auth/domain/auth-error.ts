export type AuthAction = 'login' | 'register' | 'config';

/** Fallo de autenticación con un mensaje ya apto para la persona usuaria. */
export class AuthError extends Error { }
