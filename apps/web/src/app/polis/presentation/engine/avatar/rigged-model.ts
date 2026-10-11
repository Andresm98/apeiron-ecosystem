import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { FigureInfo, parseFigures } from '../../../domain/figure-catalog';
import type { ClipWeights, Stride } from './animator';
import { CLIP_NAMES, ClipKey, actionStates, findClip, strideOf, upperBodyOnly } from './gltf-clips';

const BASE = 'assets/polis/characters/';

/** Figuras publicadas en `characters/manifest.json` (v1 o v2); sin manifiesto, ninguna: todo es procedural. */
export async function loadFigureCatalog(): Promise<FigureInfo[]> {
  try {
    const res = await fetch(`${BASE}manifest.json`);
    return res.ok ? parseFigures(await res.json()) : [];
  } catch {
    return [];
  }
}

/** Plantilla: escena, clips y su caja en reposo (medida una vez: la de una copia recién clonada no es fiable). */
interface RigTemplate { scene: THREE.Object3D; clips: THREE.AnimationClip[]; box: THREE.Box3; }
const rigs = new Map<string, Promise<RigTemplate>>();

/**
 * Plantilla de un personaje animado (`<id>.glb` con esqueleto y clips), cargada una vez. Exige `Idle` y `Walk`:
 * sin ellos la máquina de estados no puede moverlo.
 */
export function loadRig(id: string): Promise<RigTemplate> {
  let pending = rigs.get(id);
  if (!pending) {
    pending = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${BASE}${id}.glb`).then((gltf) => {
      if (!findClip(gltf.animations, CLIP_NAMES.idle) || !findClip(gltf.animations, CLIP_NAMES.walk)) {
        throw new Error(`${id}.glb necesita al menos los clips Idle y Walk`);
      }
      return { scene: gltf.scene, clips: gltf.animations, box: new THREE.Box3().setFromObject(gltf.scene) };
    });
    pending.catch(() => rigs.delete(id)); // un fallo no se queda cacheado
    rigs.set(id, pending);
  }
  return pending;
}

/**
 * Personaje con esqueleto y clips (Blender o Mixamo) movido por la máquina de estados de ssanax (`Animator`): lo
 * usan ssanax y los agentes con figura animada. Es una copia propia de la plantilla (`SkeletonUtils.clone`: cada
 * una con su esqueleto), escalada a `height` y apoyada en el suelo.
 */
export class RiggedModel {
  readonly object: THREE.Object3D;
  /** Metros por ciclo de sus clips (`extras.apeiron.stride`); si no, el del rig procedural. */
  readonly stride: Stride | undefined;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipKey, THREE.AnimationAction>();
  private readonly durations: Partial<Record<ClipKey, number>> = {};

  constructor(template: RigTemplate, height: number) {
    const model = cloneSkinned(template.scene);
    // La caja de la plantilla: la de una malla con esqueleto de varias primitivas recién clonada sale disparatada.
    const box = template.box;
    const k = height / (box.max.y - box.min.y || 1);
    model.scale.multiplyScalar(k);
    model.position.y -= box.min.y * k;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // la caja de la malla en reposo no sigue a la animación
    });
    this.mixer = new THREE.AnimationMixer(model);
    for (const [key, name] of Object.entries(CLIP_NAMES) as [ClipKey, string][]) {
      const found = findClip(template.clips, name);
      if (!found) continue;
      const locomotion = key === 'idle' || key === 'walk' || key === 'run' || key === 'jump';
      const clip = locomotion ? found : upperBodyOnly(found);
      const action = this.mixer.clipAction(clip);
      action.setEffectiveWeight(0).play();
      this.actions.set(key, action);
      this.durations[key] = clip.duration;
    }
    this.stride = strideOf(template.scene.userData, height, this.actions.has('run'));
    this.object = model;
  }

  /** Pesos y tiempos de un fotograma del animador: caminar y correr en fase, salto según el vuelo, gestos arriba. */
  apply(weights: ClipWeights, dt: number): void {
    const states = actionStates(weights, new Set(this.actions.keys()), this.durations);
    for (const [key, action] of this.actions) {
      const state = states[key];
      action.setEffectiveWeight(state?.weight ?? 0);
      if (state?.time !== null && state?.time !== undefined) action.time = state.time;
    }
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.object.removeFromParent();
  }
}
