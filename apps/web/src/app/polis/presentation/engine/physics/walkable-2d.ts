import { type Place, isWalkable } from '../../../domain/city-layout.ts';
import type { Flat, PolisPhysics } from './walkable.ts';

export interface Obstacle { x: number; z: number; r: number; }

/**
 * Física por defecto: islas circulares, puentes y monumentos de `isWalkable`, más los obstáculos de la arquitectura
 * (columnas, altares, estatuas). Si el paso completo no es posible, prueba cada eje por separado (desliza por los
 * bordes). No tiene sensores: la proximidad la da `nearestPlace`.
 */
export class Walkable2D implements PolisPhysics {
  private readonly places: () => Place[];
  private readonly obstacles: () => Obstacle[];

  constructor(places: () => Place[], obstacles: () => Obstacle[] = () => []) {
    this.places = places;
    this.obstacles = obstacles;
  }

  move(from: Flat, delta: Flat): Flat {
    const ok = (x: number, z: number) => isWalkable(this.places(), x, z) && this.clear(from, x, z);
    if (ok(from.x + delta.x, from.z + delta.z)) return { x: from.x + delta.x, z: from.z + delta.z };
    if (ok(from.x + delta.x, from.z)) return { x: from.x + delta.x, z: from.z };
    if (ok(from.x, from.z + delta.z)) return { x: from.x, z: from.z + delta.z };
    return from;
  }

  /** Fuera de todo obstáculo, o alejándose del que se pisa (quien aparece dentro de uno siempre puede salir). */
  private clear(from: Flat, x: number, z: number): boolean {
    for (const o of this.obstacles()) {
      const next = Math.hypot(x - o.x, z - o.z);
      if (next < o.r && next <= Math.hypot(from.x - o.x, from.z - o.z)) return false;
    }
    return true;
  }

  sensors(): string[] {
    return [];
  }

  dispose(): void {
    /* sin recursos */
  }
}
