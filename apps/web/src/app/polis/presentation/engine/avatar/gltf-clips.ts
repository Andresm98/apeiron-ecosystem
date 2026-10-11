import * as THREE from 'three';
import type { ClipWeights, Stride } from './animator.ts';
import type { Gesture } from './clips.ts';

/**
 * Clips que debe traer un `ssanax.glb` riggeado (Blender o Mixamo) para que la misma máquina de estados lo anime.
 * Basta con `Idle` y `Walk`; lo que falte cae en el clip más cercano (correr → caminar, gestos → ninguno).
 */
export const CLIP_NAMES = {
  idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump',
  wave: 'Wave', talk: 'Talk', think: 'Think', shrug: 'Shrug', point: 'Point', summon: 'Summon', nod: 'Nod',
  beckon: 'Beckon', lookAround: 'LookAround', stretch: 'Stretch',
} as const satisfies Record<'idle' | 'walk' | 'run' | 'jump' | Gesture, string>;

export type ClipKey = keyof typeof CLIP_NAMES;

/** Busca un clip por nombre sin distinguir mayúsculas ni el prefijo que añade Mixamo (`Armature|Walk`). */
export function findClip(clips: THREE.AnimationClip[], name: string): THREE.AnimationClip | null {
  const want = name.toLowerCase();
  return clips.find((c) => c.name.toLowerCase() === want)
    ?? clips.find((c) => c.name.toLowerCase().split('|').at(-1) === want)
    ?? null;
}

/** Huesos de piernas y cadera en las convenciones habituales (Mixamo, Rigify, nuestro rig). */
const LOWER_BODY = /(hips|pelvis|root|thigh|upleg|leg|shin|calf|knee|foot|toe|ankle)/i;

/**
 * Versión de un clip de gesto sin las pistas de cadera y piernas: el gesto se mezcla sobre la locomoción y
 * ssanax puede saludar mientras camina.
 */
export function upperBodyOnly(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => !LOWER_BODY.test(t.name.split('.')[0] ?? ''));
  return new THREE.AnimationClip(`${clip.name}:upper`, clip.duration, tracks);
}

export interface ActionState { weight: number; time: number | null; }

/**
 * Peso y tiempo de cada acción para un fotograma del animador. Caminar y correr se sincronizan con la fase (los
 * pies del modelo no patinan); el salto, con el progreso del vuelo (el clip es solo el tramo en el aire); los gestos
 * de una vez, con su progreso. `time = null` = dejar que el mixer avance.
 */
export function actionStates(w: ClipWeights, available: ReadonlySet<ClipKey>, durations: Partial<Record<ClipKey, number>>): Partial<Record<ClipKey, ActionState>> {
  const out: Partial<Record<ClipKey, ActionState>> = {};
  const runKey: ClipKey = available.has('run') ? 'run' : 'walk';
  const jumpKey: ClipKey | null = available.has('jump') ? 'jump' : null;
  const sync = (key: ClipKey) => (durations[key] ?? 1) * w.phase;
  const put = (key: ClipKey, weight: number, time: number | null) => {
    if (!available.has(key) || weight <= 0) return;
    const prev = out[key];
    out[key] = { weight: (prev?.weight ?? 0) + weight, time: prev?.time ?? time };
  };
  put('idle', w.idle + (jumpKey ? 0 : w.jump), null);
  put('walk', w.walk, sync('walk'));
  put(runKey, w.run, sync(runKey));
  if (jumpKey) put(jumpKey, w.jump, (durations[jumpKey] ?? 1) * w.air);
  if (w.gesture && available.has(w.gesture.name)) {
    const d = durations[w.gesture.name];
    out[w.gesture.name] = { weight: w.gesture.weight, time: w.gesture.progress > 0 && d ? d * w.gesture.progress : null };
  }
  return out;
}

/** Correr frente a caminar en el rig procedural (4 / 2,4 piernas por ciclo): si hay `Run` pero no su zancada. */
const RUN_PER_WALK = 4 / 2.4;

/**
 * Zancada que declara el glb en los `extras` de su escena (`apeiron.stride.walk`/`run`, en alturas del modelo en
 * reposo, la misma medida con la que se escala) llevada a metros. Sin `Run`, se corre con el ciclo de caminar.
 */
export function strideOf(extras: Record<string, unknown>, height: number, hasRun: boolean): Stride | undefined {
  const declared = (extras['apeiron'] as { stride?: { walk?: unknown; run?: unknown } } | undefined)?.stride;
  const walk = typeof declared?.walk === 'number' && declared.walk > 0 ? declared.walk * height : 0;
  if (!walk) return undefined;
  const run = typeof declared?.run === 'number' && declared.run > 0 ? declared.run * height : hasRun ? walk * RUN_PER_WALK : walk;
  return { walk, run };
}
