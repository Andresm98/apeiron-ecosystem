import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { LOD_DISTANCES, LandmarkPlan, planLandmark, splitLod } from '../../../../domain/landmark-conventions';
import { toSceneNodes } from './scene-nodes';

/** Carpeta servida con los landmarks optimizados (`gltf-transform optimize --compress meshopt`). */
const BASE = 'assets/polis/landmarks/'; // nunca bajo /polis: una carpeta con el nombre de la ruta rompe la SPA en nginx

export interface LoadedLandmark { object: THREE.Group; plan: LandmarkPlan; }

/**
 * Landmarks disponibles según `manifest.json`: la ciudad solo pide los que existen (un 404 por landmark ensuciaría
 * la consola y los E2E). Si el manifiesto falta, todo es procedural.
 */
export async function availableLandmarks(): Promise<Set<string>> {
  try {
    const res = await fetch(`${BASE}manifest.json`);
    if (!res.ok) return new Set();
    const body = (await res.json()) as { landmarks?: unknown };
    return new Set(Array.isArray(body.landmarks) ? body.landmarks.filter((l): l is string => typeof l === 'string') : []);
  } catch {
    return new Set();
  }
}

let loader: GLTFLoader | null = null;
const cache = new Map<string, Promise<LoadedLandmark>>();

/**
 * Carga `<landmark>.glb` y le aplica las convenciones (ADR-013 §5.5): oculta colisionadores simplificados, sensores,
 * suelo pisable y empties; monta `THREE.LOD` desde `_lod0/1/2`; convierte los materiales `baked_*` en
 * `MeshBasicMaterial` (luz, sombra y AO ya están en la textura: cero cálculo de luz) y conserva la AO del glTF en
 * los demás. Se cachea por landmark y se clona para cada lugar.
 */
export function loadLandmark(landmark: string): Promise<LoadedLandmark> {
  let pending = cache.get(landmark);
  if (!pending) {
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    pending = loader.loadAsync(`${BASE}${landmark}.glb`).then((gltf) => {
      const root = gltf.scene;
      const plan = planLandmark(toSceneNodes(root), root.userData, landmark);
      if (plan.problems.length) throw new Error(`${landmark}.glb: ${plan.problems.join('; ')}`);
      prepare(root, plan);
      return { object: root, plan };
    });
    pending.catch(() => cache.delete(landmark)); // un fallo no se queda cacheado
    cache.set(landmark, pending);
  }
  return pending.then(({ object, plan }) => ({ object: object.clone(true), plan }));
}

function prepare(root: THREE.Group, plan: LandmarkPlan): void {
  const hidden = new Set(plan.hidden);
  root.traverse((o) => {
    if (hidden.has(o.name)) o.visible = false;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !o.visible) return;
    mesh.material = bake(mesh.material as THREE.Material);
    const unlit = (mesh.material as THREE.Material).type === 'MeshBasicMaterial';
    mesh.castShadow = !unlit; // lo horneado ya trae su sombra
    mesh.receiveShadow = !unlit;
    mesh.userData['occluder'] = true;
  });
  for (const base of Object.keys(plan.lods)) buildLod(root, base);
}

/** `baked_*`: textura con luz y sombra horneadas → material sin iluminación. */
function bake(material: THREE.Material): THREE.Material {
  if (!material.name.startsWith('baked')) return material;
  const source = material as THREE.MeshStandardMaterial;
  const basic = new THREE.MeshBasicMaterial({ name: material.name, map: source.map ?? null, fog: true });
  if (basic.map) basic.map.colorSpace = THREE.SRGBColorSpace;
  material.dispose();
  return basic;
}

/** Sustituye `<base>_lod0..2` por un `THREE.LOD` en la posición de lod0 (distancias 0 / 35 / 70 m). */
function buildLod(root: THREE.Group, base: string): void {
  const levels: THREE.Object3D[] = [];
  root.traverse((o) => {
    const { base: b, lod } = splitLod(o.name.replace(/\.\d{3}$/, ''));
    if (b === base && lod !== null) levels[lod] = o;
  });
  const first = levels[0];
  if (!first?.parent) return;
  const lod = new THREE.LOD();
  lod.name = base;
  lod.position.copy(first.position);
  lod.quaternion.copy(first.quaternion);
  lod.scale.copy(first.scale);
  first.parent.add(lod);
  levels.forEach((level, i) => {
    if (!level) return;
    level.parent?.remove(level);
    level.position.set(0, 0, 0);
    level.quaternion.identity();
    level.scale.set(1, 1, 1);
    lod.addLevel(level, LOD_DISTANCES[i]);
  });
}
