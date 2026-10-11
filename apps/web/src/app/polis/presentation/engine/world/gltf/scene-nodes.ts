import * as THREE from 'three';
import { classify, type SceneNode } from '../../../../domain/landmark-conventions.ts';

/**
 * Aplana un glTF importado a `SceneNode` en el espacio del landmark (su raíz = centro de la isla), que es lo que lee
 * el parser de convenciones. Solo extrae geometría exacta (trimesh) para los `fixed_*` sin sufijo `_box`/`_cyl`.
 */
export function toSceneNodes(root: THREE.Object3D): SceneNode[] {
  root.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const nodes: SceneNode[] = [];
  root.traverse((object) => {
    if (object === root) return;
    const matrix = new THREE.Matrix4().multiplyMatrices(toLocal, object.matrixWorld);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, rotation, scale);
    const mesh = object as THREE.Mesh;
    const isMesh = !!mesh.isMesh;
    let halfExtents: [number, number, number] = [0, 0, 0];
    if (isMesh) {
      mesh.geometry.computeBoundingBox();
      const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(scale).multiplyScalar(0.5);
      halfExtents = [size.x, size.y, size.z];
    }
    const node: SceneNode = {
      name: object.name,
      position: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      scale: [scale.x, scale.y, scale.z],
      halfExtents,
      isMesh,
    };
    const role = classify(object.name);
    if (isMesh && role.kind === 'fixed' && role.shape === 'trimesh') Object.assign(node, trimesh(mesh, matrix));
    nodes.push(node);
  });
  return nodes;
}

/** Vértices en espacio del landmark e índices (se generan si la geometría no está indexada). */
function trimesh(mesh: THREE.Mesh, matrix: THREE.Matrix4): { vertices: Float32Array; indices: Uint32Array } {
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const vertices = new Float32Array(position.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(matrix);
    vertices.set([v.x, v.y, v.z], i * 3);
  }
  const index = mesh.geometry.getIndex();
  const indices = index ? Uint32Array.from(index.array) : Uint32Array.from({ length: position.count }, (_, i) => i);
  return { vertices, indices };
}
