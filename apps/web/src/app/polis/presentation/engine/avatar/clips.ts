import { type BoneName, UPPER_BODY, type Vec3 } from './rig.ts';

/**
 * Clips procedurales de ssanax: funciones puras del tiempo o de la fase que devuelven rotaciones (Euler XYZ, rad)
 * por hueso, más el desplazamiento vertical de la cadera y el *squash* del aterrizaje.
 *
 * Convenciones (personaje mirando a +Z): en un hueso que cuelga, `+x` lleva su extremo hacia atrás (muslo atrás,
 * rodilla doblada en la tibia); `-x` en el brazo lo lleva adelante; `+z` separa el brazo izquierdo, `-z` el derecho;
 * en la cabeza `+x` mira abajo y `+y` gira a su izquierda; en la columna `+x` inclina hacia delante.
 */
export interface Pose {
  bones: Partial<Record<BoneName, Vec3>>;
  hipsY: number;
  squash: number;
}

export const emptyPose = (): Pose => ({ bones: {}, hipsY: 0, squash: 0 });

const TAU = Math.PI * 2;
const pos = (v: number) => Math.max(0, v);

export function bone(pose: Pose, name: BoneName): Vec3 {
  return pose.bones[name] ?? [0, 0, 0];
}

/** Mezcla lineal de dos poses (ángulos pequeños: suficiente para clips procedurales). */
export function blend(a: Pose, b: Pose, w: number, mask?: ReadonlySet<BoneName>): Pose {
  if (w <= 0) return a;
  const out: Pose = { bones: { ...a.bones }, hipsY: a.hipsY, squash: a.squash };
  const names = new Set([...Object.keys(a.bones), ...Object.keys(b.bones)] as BoneName[]);
  for (const name of names) {
    if (mask && !mask.has(name)) continue;
    const x = bone(a, name);
    const y = bone(b, name);
    out.bones[name] = [x[0] + (y[0] - x[0]) * w, x[1] + (y[1] - x[1]) * w, x[2] + (y[2] - x[2]) * w];
  }
  if (!mask) {
    out.hipsY = a.hipsY + (b.hipsY - a.hipsY) * w;
    out.squash = a.squash + (b.squash - a.squash) * w;
  }
  return out;
}

/** Suma (para capas aditivas: respiración, mirada, cabeceo). */
export function add(a: Pose, b: Pose, w = 1): Pose {
  const out: Pose = { bones: { ...a.bones }, hipsY: a.hipsY + b.hipsY * w, squash: a.squash + b.squash * w };
  for (const [name, v] of Object.entries(b.bones) as [BoneName, Vec3][]) {
    const x = bone(a, name);
    out.bones[name] = [x[0] + v[0] * w, x[1] + v[1] * w, x[2] + v[2] * w];
  }
  return out;
}

// Locomoción --------------------------------------------------------------------------------

/** Reposo: respiración, peso que se desplaza, brazos sueltos. */
export function idle(t: number): Pose {
  const breath = Math.sin((TAU * t) / 3.6);
  const sway = Math.sin((TAU * t) / 5.3);
  return {
    bones: {
      hips: [0, 0, 0.025 * sway],
      spine: [0.03, 0, -0.015 * sway],
      chest: [-0.025 * breath, 0, 0],
      head: [-0.03 + 0.015 * breath, 0.06 * Math.sin((TAU * t) / 7.1), 0.01 * sway],
      'upperArm.L': [0.04, 0, 0.09 + 0.015 * breath],
      'upperArm.R': [0.04, 0, -0.09 - 0.015 * breath],
      'foreArm.L': [-0.16, 0, 0],
      'foreArm.R': [-0.16, 0, 0],
      'thigh.L': [-0.02, 0, 0.04 + 0.02 * sway],
      'thigh.R': [-0.02, 0, -0.04 + 0.02 * sway],
      'shin.L': [0.04, 0, 0],
      'shin.R': [0.04, 0, 0],
    },
    hipsY: 0.008 * breath - 0.005,
    squash: 0,
  };
}

/**
 * Ciclo de piernas y brazos con la fase φ ∈ [0, 1): un ciclo = dos pasos. `k` = 0 caminar, 1 correr (amplitudes,
 * inclinación, codos). En φ = 0 y 0,5 las piernas se cruzan; en 0,25 (izquierda delante) y 0,75 (derecha) están más
 * separadas: ahí apoyan y la cadera baja.
 */
export function stride(phase: number, k: number): Pose {
  const s = Math.sin(TAU * phase);
  const c = Math.cos(TAU * phase);
  const swing = 0.5 + 0.35 * k;
  const arm = 0.38 + 0.42 * k;
  const knee = 0.65 + 0.55 * k;
  const lean = 0.06 + 0.22 * k;
  return {
    bones: {
      hips: [0, 0.12 * s, 0.04 * c],
      spine: [lean, -0.05 * s, 0],
      chest: [0.02 * k, -0.16 * s, 0],
      head: [-lean * 0.7, 0.08 * s, 0],
      'thigh.L': [-swing * s, 0, 0.03],
      'thigh.R': [swing * s, 0, -0.03],
      'shin.L': [0.12 + knee * pos(c), 0, 0],
      'shin.R': [0.12 + knee * pos(-c), 0, 0],
      'foot.L': [0.25 * s - 0.2 * pos(c) * k, 0, 0],
      'foot.R': [-0.25 * s - 0.2 * pos(-c) * k, 0, 0],
      'upperArm.L': [arm * s, 0, 0.08],
      'upperArm.R': [-arm * s, 0, -0.08],
      'foreArm.L': [-0.3 - 1.0 * k - 0.15 * pos(s), 0, 0],
      'foreArm.R': [-0.3 - 1.0 * k - 0.15 * pos(-s), 0, 0],
    },
    hipsY: -(0.035 + 0.05 * k) * Math.abs(s) + 0.02 + 0.05 * k * pos(Math.abs(c) - 0.6),
    squash: 0,
  };
}

/** En el aire: piernas recogidas y brazos que equilibran; `vy` > 0 subiendo, < 0 cayendo. */
export function airborne(vy: number): Pose {
  const fall = Math.min(1, Math.max(0, -vy / 6));
  return {
    bones: {
      spine: [0.08 - 0.1 * fall, 0, 0],
      head: [-0.12, 0, 0],
      'thigh.L': [-0.75, 0, 0.06],
      'thigh.R': [-0.35 + 0.2 * fall, 0, -0.06],
      'shin.L': [1.05, 0, 0],
      'shin.R': [0.55, 0, 0],
      'foot.L': [0.2, 0, 0],
      'upperArm.L': [-0.3, 0, 0.7 + 0.5 * fall],
      'upperArm.R': [-0.3, 0, -0.7 - 0.5 * fall],
      'foreArm.L': [-0.5, 0, 0],
      'foreArm.R': [-0.5, 0, 0],
    },
    hipsY: 0,
    squash: -0.06 * (1 - fall), // estirado al despegar
  };
}

/** Aterrizaje (u ∈ [0, 1]): flexión que absorbe el golpe y vuelve. */
export function landing(u: number, impact: number): Pose {
  const e = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * Math.min(1, impact);
  return {
    bones: {
      spine: [0.2 * e, 0, 0],
      'thigh.L': [-0.55 * e, 0, 0.05],
      'thigh.R': [-0.55 * e, 0, -0.05],
      'shin.L': [1.0 * e, 0, 0],
      'shin.R': [1.0 * e, 0, 0],
      'foot.L': [-0.45 * e, 0, 0],
      'foot.R': [-0.45 * e, 0, 0],
      'upperArm.L': [-0.2 * e, 0, 0.35 * e],
      'upperArm.R': [-0.2 * e, 0, -0.35 * e],
    },
    hipsY: -0.16 * e,
    squash: 0.12 * e,
  };
}

// Gestos (tren superior) -------------------------------------------------------------------

export type Gesture =
  | 'wave' | 'talk' | 'think' | 'shrug' | 'point' | 'summon' | 'nod' | 'beckon' | 'lookAround' | 'stretch';

/** Duración de los gestos de una vez; los de bucle (`talk`, `think`) duran lo que dure su causa. */
export const GESTURE_SECONDS: Record<Gesture, number | null> = {
  wave: 2.2, talk: null, think: null, shrug: 1.5, point: 1.7, summon: 2, nod: 1.1, beckon: 1.9, lookAround: 3.6, stretch: 2.8,
};

/** Pose del gesto en el instante `t` (s) con progreso `u` ∈ [0, 1] (0 en los de bucle). */
export function gesture(name: Gesture, t: number, u: number): Pose {
  const bump = Math.sin(Math.PI * u); // sube y baja en los de una vez
  const p = emptyPose();
  const b = p.bones;
  switch (name) {
    case 'wave': {
      const hello = Math.sin(TAU * 2.6 * t);
      b['upperArm.R'] = [-0.25, 0, -2.45];
      b['foreArm.R'] = [-0.25, 0, 0.45 * hello];
      b['hand.R'] = [0, 0, 0.25 * hello];
      b['upperArm.L'] = [0.05, 0, 0.12];
      b['foreArm.L'] = [-0.2, 0, 0];
      b.head = [-0.05, -0.12, -0.1];
      b.chest = [-0.04, -0.08, 0.05];
      break;
    }
    case 'talk': {
      const a = Math.sin(TAU * 0.9 * t);
      const c = Math.sin(TAU * 0.9 * t + 1.9);
      b['upperArm.L'] = [-0.45 - 0.18 * a, 0, 0.35 + 0.1 * a];
      b['foreArm.L'] = [-0.95 + 0.3 * a, 0, 0];
      b['hand.L'] = [0.2 * a, 0, 0];
      b['upperArm.R'] = [-0.45 - 0.18 * c, 0, -0.35 - 0.1 * c];
      b['foreArm.R'] = [-0.95 + 0.3 * c, 0, 0];
      b['hand.R'] = [0.2 * c, 0, 0];
      b.chest = [0, 0.08 * Math.sin(TAU * 0.45 * t), 0];
      b.head = [0.06 * Math.sin(TAU * 1.6 * t), 0.1 * Math.sin(TAU * 0.5 * t), 0];
      break;
    }
    case 'think': {
      const tap = Math.sin(TAU * 0.35 * t);
      b['upperArm.R'] = [-0.85, 0, 0.2];
      b['foreArm.R'] = [-2.15, 0, 0];
      b['hand.R'] = [0.35, 0, 0];
      b['upperArm.L'] = [-0.4, 0, -0.15];
      b['foreArm.L'] = [-1.45, 0, 0];
      b.head = [0.14, 0.05 * tap, 0.12];
      b.chest = [0.04, 0, 0];
      p.hipsY = -0.01;
      break;
    }
    case 'shrug':
      b['upperArm.L'] = [-0.3 * bump, 0, 0.12 + 0.35 * bump];
      b['upperArm.R'] = [-0.3 * bump, 0, -0.12 - 0.35 * bump];
      b['foreArm.L'] = [-0.2 - 1.2 * bump, 0, 0];
      b['foreArm.R'] = [-0.2 - 1.2 * bump, 0, 0];
      b['hand.L'] = [0, 0, 0.4 * bump];
      b['hand.R'] = [0, 0, -0.4 * bump];
      b.chest = [-0.06 * bump, 0, 0];
      b.head = [-0.04 * bump, 0, 0.18 * bump];
      p.hipsY = 0.03 * bump;
      break;
    case 'point':
      b['upperArm.R'] = [-1.45 * bump, 0, -0.08];
      b['foreArm.R'] = [-0.12, 0, 0];
      b['upperArm.L'] = [0.05, 0, 0.12];
      b.chest = [0, -0.18 * bump, 0];
      b.head = [0, -0.12 * bump, 0];
      break;
    case 'summon':
      b['upperArm.L'] = [-0.2, 0, 0.12 + 2.3 * bump];
      b['upperArm.R'] = [-0.2, 0, -0.12 - 2.3 * bump];
      b['foreArm.L'] = [-0.3 * bump, 0, 0];
      b['foreArm.R'] = [-0.3 * bump, 0, 0];
      b.chest = [-0.12 * bump, 0, 0];
      b.head = [-0.25 * bump, 0, 0];
      p.hipsY = 0.04 * bump;
      break;
    case 'nod':
      b.head = [0.28 * Math.sin(TAU * 2 * u) * (1 - u), 0, 0];
      b.neck = [0.08 * Math.sin(TAU * 2 * u) * (1 - u), 0, 0];
      break;
    case 'beckon': {
      const curl = pos(Math.sin(TAU * 2.4 * t));
      b['upperArm.R'] = [-1.05 * bump, 0, -0.15];
      b['foreArm.R'] = [-0.4 - 0.9 * curl * bump, 0, 0];
      b['hand.R'] = [-0.4 * curl * bump, 0, 0];
      b.head = [0, -0.1 * bump, -0.08 * bump];
      break;
    }
    case 'lookAround': {
      const look = Math.sin(TAU * u);
      b.head = [-0.05, 0.85 * look, 0];
      b.neck = [0, 0.25 * look, 0];
      b.chest = [0, 0.18 * look, 0];
      break;
    }
    case 'stretch':
      b['upperArm.L'] = [-0.1, 0, 0.12 + 2.7 * bump];
      b['upperArm.R'] = [-0.1, 0, -0.12 - 2.7 * bump];
      b['foreArm.L'] = [-0.5 * bump, 0, 0];
      b['foreArm.R'] = [-0.5 * bump, 0, 0];
      b.chest = [-0.22 * bump, 0, 0];
      b.spine = [-0.08 * bump, 0, 0];
      b.head = [-0.3 * bump, 0, 0];
      p.hipsY = 0.03 * bump;
      break;
  }
  return p;
}

export { UPPER_BODY };
