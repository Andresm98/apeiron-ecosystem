import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Lotes estáticos (ADR-013 §5.7): las mallas fijas de un lugar que comparten aspecto se fusionan en una sola, así
 * cada pieza no cuesta un draw call en el pase de color y otro en el de sombras. Se respeta lo que no puede
 * fusionarse: lo animado (`userData.dynamic` en la malla o en un ancestro), las piezas glTF cuya geometría comparten
 * varios lugares (`userData.shared`), lo translúcido y lo que tiene otro papel (suelo, oclusor, proyecta sombra o
 * no). El lote es por lugar: la selección y la oclusión siguen funcionando.
 * Devuelve cuántas mallas se ahorraron.
 */
export function batchStatic(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || (mesh.material as THREE.Material).transparent) return;
    if (isDynamic(mesh, root)) return;
    const key = materialKey(mesh);
    groups.set(key, [...(groups.get(key) ?? []), mesh]);
  });

  let saved = 0;
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
    });
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!geometry) continue;
    const [first] = meshes as [THREE.Mesh];
    const batch = new THREE.Mesh(geometry, first.material);
    batch.name = 'batch';
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.userData = { ...first.userData };
    root.add(batch);
    for (const mesh of meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      if (mesh.material !== first.material) (mesh.material as THREE.Material).dispose();
    }
    saved += meshes.length - 1;
  }
  pruneEmpty(root);
  return saved;
}

function isDynamic(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o && o !== root; o = o.parent) if (o.userData['dynamic'] || o.userData['shared']) return true;
  return false;
}

/** Aspecto + papel: dos mallas con la misma clave pueden dibujarse como una. */
function materialKey(mesh: THREE.Mesh): string {
  const m = mesh.material as THREE.MeshLambertMaterial;
  return [
    m.type, m.color?.getHexString(), m.emissive?.getHexString(), m.emissiveIntensity, m.side, m.flatShading,
    mesh.castShadow, mesh.receiveShadow, !!mesh.userData['ground'], !!mesh.userData['occluder'],
  ].join('|');
}

/** Retira los grupos que quedaron vacíos tras fusionar (columnas, árboles…). */
function pruneEmpty(root: THREE.Object3D): void {
  for (const child of [...root.children]) {
    pruneEmpty(child);
    if (child.type === 'Group' && child.children.length === 0 && !child.userData['dynamic']) child.removeFromParent();
  }
}
