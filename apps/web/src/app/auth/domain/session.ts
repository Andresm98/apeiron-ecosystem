/** Sesión abierta: token de acceso y nombre visible (usuario o correo). */
export interface AuthSession {
  token: string;
  username: string;
  /** true si el proveedor persiste y renueva la sesión (Supabase); false si vive en memoria. */
  persistent: boolean;
}

/** Lo que el proveedor de identidad configurado permite hacer. */
export interface AuthCapabilities {
  provider: 'local' | 'supabase';
  identifier: 'username' | 'email';
  registrationOpen: boolean;
  runsEnabled: boolean;
}

export const LOCAL_CAPABILITIES: AuthCapabilities = {
  provider: 'local',
  identifier: 'username',
  registrationOpen: true,
  runsEnabled: false,
};

/** Resultado del registro: sesión abierta o pendiente de confirmar el correo. */
export type SignUpResult = 'signed-in' | 'confirm-email';
