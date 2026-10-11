import * as THREE from 'three';
import { PALETTE } from '../../../domain/atmosphere';

const FLAME = new THREE.Color('#ff9a45').multiplyScalar(3.2); // HDR naranja: brilla sin quemarse a blanco

/**
 * Antorchas de la Polis: trípode, cuenco, llama HDR que parpadea y un charco de luz cálida aditivo en el suelo que
 * finge su iluminación (sin luces dinámicas: el presupuesto de 4 es para ssanax y los oradores). Todas las
 * antorchas de la ciudad son 4 draw calls.
 */
export class Torches {
  readonly group = new THREE.Group();
  private readonly flames: THREE.InstancedMesh;
  private readonly pools: THREE.InstancedMesh;
  private readonly spots: THREE.Vector3[];
  private readonly matrix = new THREE.Matrix4();

  constructor(spots: THREE.Vector3[]) {
    this.spots = spots;
    const n = Math.max(1, spots.length);
    const posts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.22, 3.2, 6).translate(0, 1.6, 0),
      new THREE.MeshLambertMaterial({ color: PALETTE.rust }),
      n,
    );
    const bowls = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.75, 0.35, 0.5, 10).translate(0, 3.35, 0),
      new THREE.MeshLambertMaterial({ color: '#3b2a1e' }),
      n,
    );
    this.flames = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.34, 1.15, 7).translate(0, 4.1, 0),
      new THREE.MeshBasicMaterial({ color: FLAME.clone() }),
      n,
    );
    this.pools = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.06, 0),
      new THREE.MeshBasicMaterial({
        map: glowTexture(), color: new THREE.Color(PALETTE.lamp).multiplyScalar(0.9), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      n,
    );
    spots.forEach((p, i) => {
      this.matrix.makeTranslation(p.x, p.y, p.z);
      posts.setMatrixAt(i, this.matrix);
      bowls.setMatrixAt(i, this.matrix);
      this.flames.setMatrixAt(i, this.matrix);
      this.matrix.makeScale(16, 1, 16).setPosition(p.x, p.y, p.z);
      this.pools.setMatrixAt(i, this.matrix);
    });
    for (const m of [posts, bowls, this.flames, this.pools]) m.count = spots.length;
    posts.castShadow = false;
    this.pools.renderOrder = 2;
    this.group.add(posts, bowls, this.flames, this.pools);
  }

  /** Parpadeo: cada llama se estira y encoge con su propia fase. */
  update(t: number): void {
    this.spots.forEach((p, i) => {
      const f = 1 + Math.sin(t * 9 + i * 1.7) * 0.12 + Math.sin(t * 13.3 + i) * 0.08;
      this.matrix.makeScale(1, f, 1).setPosition(p.x, p.y + (1 - f) * 4.1, p.z);
      this.flames.setMatrixAt(i, this.matrix);
    });
    this.flames.instanceMatrix.needsUpdate = true;
    const pulse = 0.85 + 0.15 * Math.sin(t * 5.3);
    (this.pools.material as THREE.MeshBasicMaterial).color.copy(new THREE.Color(PALETTE.lamp)).multiplyScalar(0.9 * pulse);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.MeshBasicMaterial | undefined;
      material?.map?.dispose();
      material?.dispose();
    });
  }
}

let glow: THREE.CanvasTexture | null = null;

/** Degradado radial para charcos de luz y halos. */
export function glowTexture(): THREE.CanvasTexture {
  if (glow) return glow;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glow = new THREE.CanvasTexture(canvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  return glow;
}
