import type { CitizenState } from './citizen-state.ts';

/**
 * Estatuas vivas (ADR-013): los ciudadanos son estatuas de mármol que no caminan, levitan. Del estado del agente
 * salen la altura a la que flota, el balanceo y cuánto brilla su mármol con el color del agente.
 */
export interface StatuePose {
  /** Metros sobre el suelo. */
  lift: number;
  /** Balanceo lateral (rad): respiración de la piedra. */
  sway: number;
  /** Inclinación hacia delante (rad) al desplazarse. */
  lean: number;
  /** Luz propia del mármol ∈ [0, 1]: nunca 0, para que de noche no sea una silueta; sube al trabajar. */
  glow: number;
}

/** Altura de viaje: lo bastante alta para leerse como vuelo, no tanto como para salirse del rótulo. */
export const TRAVEL_LIFT = 0.45;

/** Mármol a la luz de la luna: legible en la penumbra sin competir con quien trabaja. */
export const REST_GLOW = 0.26;

/** Al acercarse ssanax, la estatua «despierta»: se eleva un palmo y su mármol se enciende con el color del agente. */
export const AWAKE_LIFT = 0.35;
export const AWAKE_GLOW = 0.62;
/** A esta distancia (m) la estatua empieza a notar a ssanax; a `CLOSE_M`, está despierta del todo. */
export const NOTICE_M = 18;
const CLOSE_M = 6;

/** Cuánto atiende una estatua a ssanax ∈ [0, 1] según la distancia: 0 lejos, 1 a su lado. */
export function attentionAt(distance: number): number {
  return Math.max(0, Math.min(1, (NOTICE_M - distance) / (NOTICE_M - CLOSE_M)));
}
const SETTLED_GLOW: Partial<Record<CitizenState, number>> = { done: 0.34, degraded: 0.3, error: 0.4 };

/**
 * Pose objetivo de una estatua. `t` en segundos; `seed` desfasa a cada ciudadano para que no respiren al unísono.
 * Quieta y en reposo apenas se mueve; razonando flota y late; de viaje vuela inclinada hacia su destino. En reposo,
 * `attention` (de `attentionAt`) la despierta cuando ssanax se acerca: se eleva y se ilumina.
 */
export function statuePose(state: CitizenState, travelling: boolean, t: number, seed = 0, attention = 0): StatuePose {
  const busy = state === 'working' || state === 'using_tool';
  const breath = Math.sin(t * 0.8 + seed);
  if (travelling) {
    return { lift: TRAVEL_LIFT + Math.sin(t * 2.2 + seed) * 0.06, sway: breath * 0.01, lean: 0.08, glow: busy ? 0.55 : 0.36 };
  }
  if (busy) {
    // Consultar una herramienta late más rápido que razonar: se distingue sin leer el rótulo.
    const rate = state === 'using_tool' ? 7 : 4;
    return { lift: 0.18 + Math.sin(t * 2.5 + seed) * 0.05, sway: breath * 0.015, lean: 0, glow: 0.55 + Math.sin(t * rate) * 0.15 };
  }
  const awake = Math.max(0, Math.min(1, attention));
  const glow = SETTLED_GLOW[state] ?? REST_GLOW;
  return {
    lift: awake * (AWAKE_LIFT + Math.sin(t * 1.6 + seed) * 0.04),
    sway: breath * 0.008,
    lean: 0,
    glow: glow + (Math.max(glow, AWAKE_GLOW) - glow) * awake,
  };
}

/** Acerca `current` a `target` sin saltos entre estados (exponencial, independiente de los fps). */
export function approach(current: number, target: number, dt: number, rate = 6): number {
  return current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)));
}
