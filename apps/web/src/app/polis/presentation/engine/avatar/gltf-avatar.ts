import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { AnimatorFrame } from './animator';
import { CharacterMotion, PlayerAvatar, decorations, groundDecorations } from './character';
import { CLIP_NAMES, ClipKey, actionStates, findClip, upperBodyOnly } from './gltf-clips';

const BASE = 'assets/polis/characters/';
const HEIGHT = 2.5;

/** Personajes publicados en `characters/manifest.json`; sin manifiesto (o sin entrada) se usa el procedural. */
export async function availableCharacters(): Promise<Set<string>> {
  try {
    const res = await fetch(`${BASE}manifest.json`);
    if (!res.ok) return new Set();
    const body = (await res.json()) as { characters?: unknown };
    return new Set(Array.isArray(body.characters) ? body.characters.filter((c): c is string => typeof c === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * ssanax desde un glTF riggeado (Blender o Mixamo): la misma máquina de estados que el procedural, aplicada a un
 * `AnimationMixer`. Caminar y correr se sincronizan con la fase; los gestos van solo al tren superior. Se escala a
 * 2,5 m y se apoya en el suelo, sea cual sea la escala de exportación.
 */
export class GltfAvatar implements PlayerAvatar {
  readonly root = new THREE.Group();
  readonly halo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly label: CSS2DObject;
  private readonly contact: THREE.Mesh;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipKey, THREE.AnimationAction>();
  private readonly durations: Partial<Record<ClipKey, number>> = {};
  private readonly model: THREE.Object3D;

  private constructor(model: THREE.Object3D, clips: THREE.AnimationClip[], name: string) {
    this.model = model;
    const box = new THREE.Box3().setFromObject(model);
    const height = box.max.y - box.min.y || 1;
    model.scale.multiplyScalar(HEIGHT / height);
    model.position.y -= box.min.y * (HEIGHT / height);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });
    this.mixer = new THREE.AnimationMixer(model);
    for (const [key, name] of Object.entries(CLIP_NAMES) as [ClipKey, string][]) {
      const found = findClip(clips, name);
      if (!found) continue;
      const locomotion = key === 'idle' || key === 'walk' || key === 'run' || key === 'jump';
      const clip = locomotion ? found : upperBodyOnly(found);
      const action = this.mixer.clipAction(clip);
      action.setEffectiveWeight(0).play();
      this.actions.set(key, action);
      this.durations[key] = clip.duration;
    }
    const deco = decorations(name);
    this.halo = deco.halo;
    this.contact = deco.contact;
    this.label = deco.label;
    this.root.add(model, this.halo, this.contact, this.label);
  }

  static async load(character: string, name: string): Promise<GltfAvatar> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(`${BASE}${character}.glb`);
    if (!findClip(gltf.animations, CLIP_NAMES.idle) || !findClip(gltf.animations, CLIP_NAMES.walk)) {
      throw new Error(`${character}.glb necesita al menos los clips Idle y Walk`);
    }
    return new GltfAvatar(gltf.scene, gltf.animations, name);
  }

  apply(frame: AnimatorFrame, motion: CharacterMotion): void {
    const states = actionStates(frame.weights, new Set(this.actions.keys()), this.durations);
    for (const [key, action] of this.actions) {
      const state = states[key];
      action.setEffectiveWeight(state?.weight ?? 0);
      if (state?.time !== null && state?.time !== undefined) action.time = state.time;
    }
    this.mixer.update(motion.dt);
    groundDecorations(this.root, this.halo, this.contact);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[];
      for (const m of Array.isArray(material) ? material : [material]) m.dispose();
    });
    this.halo.geometry.dispose();
    this.halo.material.dispose();
    this.label.element.remove();
  }
}
