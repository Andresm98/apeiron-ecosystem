import {
  GESTURE_SECONDS, type Gesture, type Pose, UPPER_BODY, add, airborne, blend, gesture, idle, landing, stride,
} from './clips.ts';
import { LEG_LENGTH } from './rig.ts';

/** Velocidades de referencia (m/s): con ellas se calibra la mezcla caminar/correr. */
export const WALK_SPEED = 3.6;
export const RUN_SPEED = 8;
/** Distancia de un ciclo completo (dos pasos): la fase avanza con la distancia, así los pies no patinan. */
const WALK_CYCLE = LEG_LENGTH * 2.4;
const RUN_CYCLE = LEG_LENGTH * 4;
const FADE_S = 0.22;
const LAND_S = 0.32;
/** Segundos quieto antes de un idle variado (mirar alrededor, estirarse). */
export const IDLE_VARIANT_AFTER_S = 9;
const IDLE_VARIANTS: Gesture[] = ['lookAround', 'stretch', 'lookAround'];

export interface AnimatorInput {
  dt: number;
  /** Velocidad horizontal real (m/s). */
  speed: number;
  grounded: boolean;
  vy: number;
  /** Tu turno: pose de pensar mientras no camina ni habla. */
  thinking: boolean;
  /** ssanax está hablando (bocadillo activo): gesticula. */
  talking: boolean;
}

export type AnimatorEvent = { kind: 'step'; foot: 'L' | 'R'; strength: number } | { kind: 'land'; impact: number };

/** Pesos de cada clip: el avatar glTF los aplica a su `AnimationMixer`; el procedural ya recibe la pose. */
export interface ClipWeights {
  idle: number;
  walk: number;
  run: number;
  jump: number;
  /** Fase del ciclo de caminar/correr ∈ [0, 1). */
  phase: number;
  gesture: { name: Gesture; weight: number; progress: number } | null;
}

export interface AnimatorFrame { pose: Pose; weights: ClipWeights; events: AnimatorEvent[]; }

interface Active { name: Gesture; elapsed: number; weight: number; stopping: boolean; loop: boolean; }

/**
 * Máquina de estados de animación de ssanax. Capa base: locomoción (reposo ↔ caminar ↔ correr por velocidad, con
 * la fase ligada a la distancia) o salto/aterrizaje. Capa superior: un gesto que solo mueve el tren superior, con
 * entrada y salida suaves; los de una vez (saludar, encogerse…) mandan sobre los de bucle (hablar > pensar).
 * Determinista: el idle variado se elige por orden, no al azar.
 */
export class Animator {
  private time = 0;
  private phase = 0;
  private stillFor = 0;
  private landing = 1;
  private impact = 0;
  private wasGrounded = true;
  private airVy = 0;
  private active: Active | null = null;
  private variant = 0;

  /** Pide un gesto de una vez; sustituye al que esté en curso. */
  play(name: Gesture): void {
    const loop = GESTURE_SECONDS[name] === null;
    this.active = { name, elapsed: 0, weight: this.active?.weight ?? 0, stopping: false, loop };
    this.stillFor = 0;
  }

  get gesture(): Gesture | null {
    return this.active && !this.active.stopping ? this.active.name : null;
  }

  update(input: AnimatorInput): AnimatorFrame {
    const dt = Math.max(0, Math.min(input.dt, 0.1));
    this.time += dt;
    const events: AnimatorEvent[] = [];

    // Locomoción: la fase avanza con la distancia recorrida.
    const k = clamp01((input.speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED));
    const cycle = WALK_CYCLE + (RUN_CYCLE - WALK_CYCLE) * k;
    const before = this.phase;
    if (input.grounded && input.speed > 0.05) this.phase = (this.phase + (input.speed * dt) / cycle) % 1;
    if (input.grounded && input.speed > 0.6) {
      // Apoyo con las piernas más separadas: φ = 0,25 (talón izquierdo delante) y φ = 0,75 (derecho).
      if (crossed(before, this.phase, 0.25)) events.push({ kind: 'step', foot: 'L', strength: 0.4 + 0.6 * k });
      if (crossed(before, this.phase, 0.75)) events.push({ kind: 'step', foot: 'R', strength: 0.4 + 0.6 * k });
    }
    const moving = clamp01(input.speed / 1.2);
    let base = blend(idle(this.time), stride(this.phase, k), moving);

    // Salto y aterrizaje.
    if (!input.grounded) this.airVy = Math.min(this.airVy, input.vy);
    if (input.grounded && !this.wasGrounded) {
      this.impact = clamp01(-this.airVy / 9);
      this.landing = 0;
      events.push({ kind: 'land', impact: this.impact });
      this.airVy = 0;
    }
    this.wasGrounded = input.grounded;
    const jump = input.grounded ? 0 : 1;
    if (!input.grounded) base = airborne(input.vy);
    else if (this.landing < 1) {
      this.landing = Math.min(1, this.landing + dt / LAND_S);
      base = add(base, landing(this.landing, this.impact));
    }

    // Gestos: bucles por estado, de una vez por petición, idle variado por aburrimiento.
    const wanted: Gesture | null = input.talking ? 'talk' : input.thinking && input.speed < 0.5 ? 'think' : null;
    const current = this.active;
    if (wanted && (!current || (current.loop && current.name !== wanted))) {
      // Entra el bucle que toca (o sustituye al otro bucle conservando su peso: transición sin salto).
      this.active = { name: wanted, elapsed: 0, weight: current?.weight ?? 0, stopping: false, loop: true };
    } else if (current?.loop) {
      current.stopping = current.name !== wanted; // ya no toca: se desvanece; si vuelve a tocar, se reanuda
    }
    const still = input.grounded && input.speed < 0.05 && !wanted && !this.active;
    this.stillFor = still ? this.stillFor + dt : 0;
    if (this.stillFor >= IDLE_VARIANT_AFTER_S) {
      this.play(IDLE_VARIANTS[this.variant++ % IDLE_VARIANTS.length]!);
    }

    let gestureWeights: ClipWeights['gesture'] = null;
    if (this.active) {
      const g = this.active;
      g.elapsed += dt;
      const duration = GESTURE_SECONDS[g.name];
      if (duration !== null && g.elapsed >= duration - FADE_S) g.stopping = true;
      g.weight = clamp01(g.weight + (g.stopping ? -dt : dt) / FADE_S);
      const progress = duration === null ? 0 : clamp01(g.elapsed / duration);
      // En el aire no hay gestos: el cuerpo entero equilibra el salto.
      const w = input.grounded ? g.weight : 0;
      if (w > 0) base = blend(base, gesture(g.name, this.time, progress), w, UPPER_BODY);
      gestureWeights = { name: g.name, weight: w, progress };
      if (g.stopping && g.weight === 0) this.active = null;
    }

    return {
      pose: base,
      weights: {
        idle: jump ? 0 : 1 - moving,
        walk: jump ? 0 : moving * (1 - k),
        run: jump ? 0 : moving * k,
        jump,
        phase: this.phase,
        gesture: gestureWeights,
      },
      events,
    };
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** ¿La fase pasó por `mark` al ir de `from` a `to` (con vuelta en 1)? */
function crossed(from: number, to: number, mark: number): boolean {
  if (from === to) return false;
  if (to > from) return from < mark && to >= mark;
  return from < mark || to >= mark; // dio la vuelta
}
