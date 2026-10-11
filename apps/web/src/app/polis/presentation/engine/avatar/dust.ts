import * as THREE from 'three';

const POOL = 32;
const LIFE_S = 0.7;

interface Puff { alive: boolean; age: number; life: number; size: number; position: THREE.Vector3; velocity: THREE.Vector3; }

/**
 * Polvo de pisadas y aterrizajes: un `InstancedMesh` reutilizado (un draw call para todas las nubecillas). Cada
 * nubecilla crece, sube un poco y se encoge hasta desaparecer.
 */
export class Dust {
  readonly mesh: THREE.InstancedMesh;
  private readonly puffs: Puff[] = [];
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(color = '#6e675a') {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.16, 0),
      new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }),
      POOL,
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < POOL; i++) {
      this.puffs.push({ alive: false, age: 0, life: LIFE_S, size: 1, position: new THREE.Vector3(), velocity: new THREE.Vector3() });
      this.mesh.setMatrixAt(i, this.hidden);
    }
  }

  /** Suelta `count` nubecillas en `at` (en el suelo), más grandes con más `strength`. */
  emit(at: THREE.Vector3, strength: number, count = 3): void {
    for (let i = 0; i < count; i++) {
      const puff = this.puffs[this.next]!;
      this.next = (this.next + 1) % POOL;
      const angle = (i / count) * Math.PI * 2 + strength * 3.1;
      puff.alive = true;
      puff.age = 0;
      puff.life = LIFE_S * (0.7 + 0.5 * strength);
      puff.size = 0.6 + 0.9 * strength;
      puff.position.set(at.x + Math.cos(angle) * 0.15, 0.08, at.z + Math.sin(angle) * 0.15);
      puff.velocity.set(Math.cos(angle) * (0.4 + strength), 0.5 + 0.6 * strength, Math.sin(angle) * (0.4 + strength));
    }
  }

  update(dt: number): void {
    this.puffs.forEach((puff, i) => {
      if (!puff.alive) return;
      puff.age += dt;
      if (puff.age >= puff.life) {
        puff.alive = false;
        this.mesh.setMatrixAt(i, this.hidden);
        return;
      }
      const u = puff.age / puff.life;
      puff.velocity.multiplyScalar(Math.max(0, 1 - dt * 3));
      puff.position.addScaledVector(puff.velocity, dt);
      const scale = puff.size * Math.sin(Math.PI * Math.min(1, u * 1.3)) + 0.01;
      this.matrix.makeScale(scale, scale * 0.7, scale).setPosition(puff.position);
      this.mesh.setMatrixAt(i, this.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
