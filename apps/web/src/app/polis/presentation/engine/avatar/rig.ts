/**
 * Esqueleto de ssanax (ADR-013, personaje): jerarquía de huesos y pose de enlace (bind pose) en metros, con el
 * personaje mirando a +Z y los pies en y = 0. Mide 2,5 m con el pelo; proporciones de personaje estilizado (cabeza
 * grande, unas 3,3 cabezas de alto). Puro: lo usan el constructor de la malla y los specs de animación.
 */

export const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'eyes', 'hair', 'scarf', 'sash',
  'upperArm.L', 'foreArm.L', 'hand.L', 'upperArm.R', 'foreArm.R', 'hand.R',
  'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R',
] as const;

export type BoneName = (typeof BONES)[number];

export type Vec3 = [number, number, number];

/** Padre y desplazamiento respecto al padre en la pose de enlace. */
export const RIG: Record<BoneName, { parent: BoneName | null; offset: Vec3 }> = {
  root: { parent: null, offset: [0, 0, 0] },
  hips: { parent: 'root', offset: [0, 0.98, 0] },
  spine: { parent: 'hips', offset: [0, 0.12, 0] },
  chest: { parent: 'spine', offset: [0, 0.22, 0] },
  neck: { parent: 'chest', offset: [0, 0.22, 0] },
  head: { parent: 'neck', offset: [0, 0.08, 0] },
  eyes: { parent: 'head', offset: [0, 0.3, 0.27] },
  hair: { parent: 'head', offset: [0, 0.6, -0.04] },
  scarf: { parent: 'chest', offset: [0.05, 0.16, 0.19] },
  sash: { parent: 'hips', offset: [0.1, 0.07, 0.2] },
  'upperArm.L': { parent: 'chest', offset: [0.24, 0.15, 0] },
  'foreArm.L': { parent: 'upperArm.L', offset: [0.03, -0.29, 0] },
  'hand.L': { parent: 'foreArm.L', offset: [0.02, -0.26, 0] },
  'upperArm.R': { parent: 'chest', offset: [-0.24, 0.15, 0] },
  'foreArm.R': { parent: 'upperArm.R', offset: [-0.03, -0.29, 0] },
  'hand.R': { parent: 'foreArm.R', offset: [-0.02, -0.26, 0] },
  'thigh.L': { parent: 'hips', offset: [0.11, -0.04, 0] },
  'shin.L': { parent: 'thigh.L', offset: [0, -0.42, 0] },
  'foot.L': { parent: 'shin.L', offset: [0, -0.42, 0] },
  'thigh.R': { parent: 'hips', offset: [-0.11, -0.04, 0] },
  'shin.R': { parent: 'thigh.R', offset: [0, -0.42, 0] },
  'foot.R': { parent: 'shin.R', offset: [0, -0.42, 0] },
};

/** Posición del hueso en el espacio del modelo (pose de enlace). */
export function bindPosition(bone: BoneName): Vec3 {
  const p: Vec3 = [0, 0, 0];
  for (let b: BoneName | null = bone; b; b = RIG[b].parent) {
    const o = RIG[b].offset;
    p[0] += o[0];
    p[1] += o[1];
    p[2] += o[2];
  }
  return p;
}

/** Huesos del tren superior: los gestos solo tocan estos; las piernas siguen con la locomoción. */
export const UPPER_BODY: ReadonlySet<BoneName> = new Set<BoneName>([
  'spine', 'chest', 'neck', 'head', 'upperArm.L', 'foreArm.L', 'hand.L', 'upperArm.R', 'foreArm.R', 'hand.R',
]);

/** Longitud de pierna (cadera → tobillo): fija la zancada para que los pies no patinen. */
export const LEG_LENGTH = 0.84;
