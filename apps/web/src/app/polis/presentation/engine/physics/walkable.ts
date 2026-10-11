import type { LandmarkPlan } from '../../../domain/landmark-conventions.ts';

/** Punto en el plano del suelo (x, z): ssanax camina sobre islas planas a y = 0. */
export interface Flat { x: number; z: number; }

/**
 * Física de la Polis como puerto (ADR-013 §5.4). El motor no sabe si detrás hay la comprobación 2D de `isWalkable`
 * o Rapier con colisionadores sacados de los glTF: solo pide mover a ssanax y qué sensores pisa.
 */
export interface PolisPhysics {
  /** Posición tras intentar desplazarse `delta` desde `from`, deslizando por los bordes. */
  move(from: Flat, delta: Flat): Flat;
  /** Sensores (`sensor_*` de los landmarks) que contienen el punto, como `lugar:id`. */
  sensors(at: Flat): string[];
  dispose(): void;
}

/** Plan de un landmark colocado en la ciudad: lo decide `layoutCity`, nunca el asset. */
export interface PlacedPlan {
  placeId: string;
  plan: LandmarkPlan;
  x: number;
  z: number;
  /** Giro alrededor de Y (el landmark mira al ágora). */
  rotationY: number;
}
