/**
 * Saludo de un pensador cuando ssanax se acerca a su santuario (ADR-013). La primera vez se presenta con su
 * epíteto, la frase que declara su manifiesto; las siguientes, con un aforismo de la casa. Ningún texto conoce a un
 * agente por su nombre: lo propio de cada uno sale de su manifiesto.
 */

/** Aforismos para las visitas repetidas: invitan a dudar y a preguntar. */
export const SAYINGS = [
  'Dudar es de sabios; creer, de ingenuos.',
  'Toda certeza merece una segunda mirada.',
  'Pregunta sin miedo: la duda abre la puerta.',
  'Quien no se contradice, no ha pensado bastante.',
] as const;

/**
 * Distancia (m) a la que el pensador saluda: alcanza el punto de llegada al viajar a su isla (a ~14 m del anfitrión).
 * Vuelve a saludar si ssanax se aleja más de `GREET_RESET_M` y regresa.
 */
export const GREET_M = 16;
export const GREET_RESET_M = GREET_M * 1.6;

/** Texto del saludo número `visit` (0 = la primera vez en esta visita a la Polis). */
export function greeting(player: string, epithet: string | undefined, visit: number): string {
  const who = player.trim() || 'viajero';
  if (visit <= 0) return `Hola, ${who}, bienvenido. ${sentence(epithet ?? SAYINGS[0])}`;
  return `De nuevo por aquí, ${who}. ${SAYINGS[(visit - 1) % SAYINGS.length]}`;
}

/** Frase con mayúscula inicial y punto final (los epítetos de los manifiestos no lo llevan). */
function sentence(text: string): string {
  const trimmed = text.trim().replace(/^[«"]|[»"]$/g, '');
  if (!trimmed) return SAYINGS[0];
  const capital = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`;
}
