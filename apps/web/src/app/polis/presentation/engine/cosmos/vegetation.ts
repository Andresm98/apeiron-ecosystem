import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../../domain/atmosphere';
import type { Place } from '../../../domain/city-layout';
import { rng, seedOf } from '../monuments';

/**
 * Vegetación de la Polis cósmica: árboles oscuros, angulosos y retorcidos, y plantas bioluminiscentes tenues en
 * cian y violeta. Instanciada (3 draw calls para toda la ciudad) y colocada de forma determinista en el borde de
 * cada isla, lejos de los puentes y del centro (no estorba al caminar).
 */
export class Vegetation {
  readonly group = new THREE.Group();

  constructor(places: Place[], density: number, avoid: (x: number, z: number) => boolean) {
    const trees: THREE.Matrix4[] = [];
    const glowsCyan: THREE.Matrix4[] = [];
    const glowsViolet: THREE.Matrix4[] = [];
    for (const place of places) {
      const rand = rng(seedOf(`veg:${place.id}`));
      const toAgora = Math.atan2(-place.z, -place.x);
      const count = Math.round(place.radius * 0.22 * density);
      for (let i = 0; i < count * 6 && trees.length < 400; i++) {
        const a = rand() * Math.PI * 2;
        const r = place.radius * (0.7 + rand() * 0.24);
        const x = place.x + Math.cos(a) * r;
        const z = place.z + Math.sin(a) * r;
        if (Math.abs(Math.atan2(Math.sin(a - toAgora), Math.cos(a - toAgora))) < 0.35) continue; // el puente
        if (avoid(x, z)) continue;
        const kind = rand();
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, 0, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.15, rand() * Math.PI * 2, (rand() - 0.5) * 0.15)),
          new THREE.Vector3().setScalar(kind < 0.3 ? 2.2 + rand() * 1.6 : 0.8 + rand() * 0.8),
        );
        if (kind < 0.3) trees.push(m);
        else if (kind < 0.65) glowsCyan.push(m);
        else glowsViolet.push(m);
        if (trees.length + glowsCyan.length + glowsViolet.length >= count * 3) break;
      }
    }
    const treeMesh = instanced(twistedTree(), new THREE.MeshLambertMaterial({ color: '#1b1822', flatShading: true }), trees);
    treeMesh.castShadow = false; // finos y de noche: su sombra no compensa su coste en el pase de sombras
    const plant = bioluminescentPlant();
    const cyan = instanced(plant, new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.energy).multiplyScalar(1.4) }), glowsCyan);
    const violet = instanced(plant, new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.energyViolet).multiplyScalar(1.4) }), glowsViolet);
    this.group.add(treeMesh, cyan, violet);
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

/** Árbol muerto anguloso: tronco en tramos que se tuercen y ramas quebradas (unos 6 m a escala 1). */
function twistedTree(): THREE.BufferGeometry {
  const rand = rng(77);
  const parts: THREE.BufferGeometry[] = [];
  const segment = (from: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, length);
    const g = new THREE.CylinderGeometry(radius * 0.7, radius, length, 5);
    g.translate(0, length / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(from.x, from.y, from.z);
    parts.push(g.index ? g.toNonIndexed() : g);
    if (depth <= 0) return;
    const bend = () => dir.clone().add(new THREE.Vector3((rand() - 0.5) * 1.1, (rand() - 0.2) * 0.6, (rand() - 0.5) * 1.1)).normalize();
    segment(to, bend(), length * 0.78, radius * 0.7, depth - 1);
    if (depth < 4 && rand() > 0.35) segment(to, bend(), length * 0.6, radius * 0.55, depth - 2);
  };
  segment(new THREE.Vector3(), new THREE.Vector3(0.1, 1, 0).normalize(), 1.9, 0.32, 4);
  const merged = mergeGeometries(parts, false)!;
  merged.computeVertexNormals();
  return merged;
}

/** Planta bioluminiscente: tallos finos con bulbos que brillan tenuemente. */
function bioluminescentPlant(): THREE.BufferGeometry {
  const rand = rng(91);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const h = 0.5 + rand() * 0.9;
    const a = (i / 5) * Math.PI * 2;
    const lean = 0.15 + rand() * 0.25;
    const stalk = new THREE.CylinderGeometry(0.02, 0.035, h, 4).translate(0, h / 2, 0).rotateZ(lean).rotateY(a);
    const tip = new THREE.Vector3(-Math.sin(lean) * h, Math.cos(lean) * h, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    const bulb = new THREE.IcosahedronGeometry(0.07 + rand() * 0.05, 0).translate(tip.x, tip.y, tip.z);
    parts.push(stalk.toNonIndexed(), bulb.index ? bulb.toNonIndexed() : bulb);
  }
  return mergeGeometries(parts, false)!;
}
