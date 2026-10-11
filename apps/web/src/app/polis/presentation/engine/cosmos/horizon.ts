import * as THREE from 'three';
import { PALETTE } from '../../../domain/atmosphere';
import { column, fallenStatue, rng } from '../monuments';

const INNER = 330;
const OUTER = 520;

/**
 * Horizonte de la Polis cósmica (capa 1 lejana): ruinas a la deriva entre 330 y 520 m (rocas flotantes, tambores
 * de columna, monolitos) y tres colosos derruidos. Con la niebla son siluetas contra la nebulosa: dan la escala.
 * Instanciado (3 draw calls) más los colosos; gira despacio entero, sin coste por pieza.
 */
export class Horizon {
  readonly group = new THREE.Group();
  /** Cuántas piezas a la deriva tiene (para reconstruir si cambia el nivel de calidad). */
  readonly size: number;

  constructor(count: number) {
    this.size = count;
    const rand = rng(4242);
    const rocks: THREE.Matrix4[] = [];
    const drums: THREE.Matrix4[] = [];
    const slabs: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = INNER + rand() * (OUTER - INNER);
      const y = -160 + rand() * 230;
      const kind = rand();
      const size = kind < 0.6 ? 6 + rand() * 26 : kind < 0.85 ? 3 + rand() * 4 : 4 + rand() * 6;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6)),
        kind < 0.6 ? new THREE.Vector3(size, size * (0.5 + rand() * 0.6), size * (0.7 + rand() * 0.5))
          : kind < 0.85 ? new THREE.Vector3(size, size * (3 + rand() * 4), size) : new THREE.Vector3(size * 0.4, size * 4, size * 1.6),
      );
      (kind < 0.6 ? rocks : kind < 0.85 ? drums : slabs).push(m);
    }
    const stone = new THREE.MeshLambertMaterial({ color: '#4d4856', flatShading: true });
    this.group.add(
      instanced(craggyRock(), stone, rocks),
      instanced(new THREE.CylinderGeometry(1, 1.05, 1, 14), stone, drums),
      instanced(new THREE.BoxGeometry(1, 1, 1), stone, slabs),
    );
    // Colosos: una cabeza, un torso y una columna gigante, lejos y medio hundidos en su roca.
    const colossi: [THREE.Object3D, number, number, number][] = [
      [fallenStatue('head', 38, 3), 0.6, 420, -40],
      [fallenStatue('torso', 30, 5), 2.7, 470, -70],
      [column(240, 9, 0.55, rand), 4.6, 400, -110],
    ];
    for (const [object, angle, radius, y] of colossi) {
      object.position.set(Math.cos(angle) * radius, y + object.position.y, Math.sin(angle) * radius);
      this.group.add(object);
    }
    this.group.traverse((o) => ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).frustumCulled = true)));
  }

  update(dt: number): void {
    this.group.rotation.y += dt * 0.0015; // la deriva lenta del cosmos
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
  }
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length));
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Roca irregular: icosaedro con los vértices desplazados de forma determinista. */
export function craggyRock(seed = 9, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const rand = rng(seed);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const cache = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    const k = cache.get(key) ?? 0.7 + rand() * 0.6; // mismo desplazamiento para vértices compartidos: sin grietas
    cache.set(key, k);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export { PALETTE };
