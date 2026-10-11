import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { splitLod } from '../../../../domain/landmark-conventions';
import { PROP_LOD_DISTANCES, PropName, propProblems, publishedProps } from '../../../../domain/props';
import { buildLod } from './loader';

/** Carpeta servida con las piezas optimizadas (meshopt + WebP). */
const BASE = 'assets/polis/props/';

export type LoadedProps = Partial<Record<PropName, THREE.Object3D>>;

let manifest: Promise<PropName[]> | null = null;

/** Piezas publicadas en `props/manifest.json` (una sola petición aunque se carguen por tandas). */
function published(): Promise<PropName[]> {
  manifest ??= fetch(`${BASE}manifest.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then(publishedProps)
    .catch(() => {
      manifest = null; // un fallo de red no se queda cacheado: la próxima visita a la Polis lo reintenta
      return [];
    });
  return manifest;
}

/**
 * Carga las piezas `wanted` que publique `props/manifest.json` (ADR-013 §5.5). Cada una es una plantilla: quien la
 * usa la clona. Una pieza que no carga o no cumple las convenciones se descarta con un aviso `prop_fallback` y su
 * hueco conserva la versión procedural; sin manifiesto, todo es procedural. Por tandas: lo que cambia la ciudad no
 * espera a lo pesado del cielo.
 */
export async function loadProps(wanted: readonly PropName[]): Promise<LoadedProps> {
  const names = (await published()).filter((name) => wanted.includes(name));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const loaded: LoadedProps = {};
  await Promise.all(names.map(async (name) => {
    try {
      const gltf = await loader.loadAsync(`${BASE}${name}.glb`);
      const problems = propProblems(gltf.scene.userData, name);
      if (problems.length) throw new Error(problems.join('; '));
      buildLods(gltf.scene);
      loaded[name] = gltf.scene;
    } catch (e) {
      console.warn('prop_fallback', { prop: name, error: e instanceof Error ? e.message : String(e) });
    }
  }));
  return loaded;
}

/** Monta un `THREE.LOD` por cada grupo de nodos `<base>_lod0/1/2` (la convención de los landmarks). */
function buildLods(root: THREE.Object3D): void {
  const bases = new Set<string>();
  root.traverse((o) => {
    const { base, lod } = splitLod(o.name.replace(/\.\d{3}$/, ''));
    if (lod !== null) bases.add(base);
  });
  for (const base of bases) buildLod(root, base, PROP_LOD_DISTANCES);
}

/**
 * Copia de una pieza ajustada a su hueco: escala uniforme para caber en `width` × `depth` (x, z), centrada en el
 * origen y apoyada en y = 0. Comparte geometría y texturas con la plantilla, así que no se fusiona en los lotes
 * estáticos (`userData.shared`); los materiales son propios, porque la oclusión vuelve translúcida cada copia por
 * separado.
 */
export function fitProp(template: THREE.Object3D, width: number, depth: number): THREE.Group {
  const copy = template.clone(true);
  copy.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
  });
  const box = new THREE.Box3().setFromObject(copy);
  const size = box.getSize(new THREE.Vector3());
  const scale = Math.min(width / (size.x || 1), depth / (size.z || 1));
  const center = box.getCenter(new THREE.Vector3());
  copy.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  const fitted = new THREE.Group();
  fitted.add(copy);
  fitted.scale.setScalar(scale);
  fitted.userData['shared'] = true;
  return fitted;
}
