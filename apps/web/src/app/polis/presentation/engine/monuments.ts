import * as THREE from 'three';
import { PALETTE } from '../../domain/atmosphere';

/**
 * Kit de arquitectura ciclópea (ADR-013, «Polis cósmica»): columnas acanaladas de decenas de metros, columnas
 * rotas y tambores caídos, columnatas con arquitrabe solo sobre los tramos que siguen en pie y el techo abierto
 * al cosmos, gradas que bajan por el borde de la isla, estatuas colosales derruidas y altares. Determinista: la
 * misma semilla da la misma ruina. Cada pieza devuelve sus obstáculos (círculos en el plano) y sus antorchas.
 */
export interface Monument {
  group: THREE.Group;
  /** Círculos que ssanax no atraviesa, en el espacio local del lugar. */
  obstacles: { x: number; z: number; r: number }[];
  /** Antorchas (base, en el espacio local): las dibuja e ilumina `Torches`. */
  torches: THREE.Vector3[];
}

const STONE = '#6d675c';
const STONE_DARK = '#4a463f';
const STONE_PALE = '#8d8574';

export function rng(seed: number): () => number {
  let s = Math.max(1, Math.floor(seed) % 2147483647);
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function seedOf(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Math.abs(h) || 1;
}

const lambert = (color: string) => new THREE.MeshLambertMaterial({ color, flatShading: true });

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

/** Columna dórica: basa, fuste de 16 caras (acanaladura facetada) y capitel. `broken` ∈ (0,1) la parte por ahí. */
export function column(height: number, radius: number, broken: number | null = null, rand = rng(1)): THREE.Group {
  const g = new THREE.Group();
  const shaftH = broken === null ? height * 0.9 : height * broken;
  g.add(mesh(new THREE.CylinderGeometry(radius * 1.3, radius * 1.4, height * 0.035, 16), lambert(STONE_DARK), 0, height * 0.0175, 0));
  g.add(mesh(new THREE.CylinderGeometry(radius * 0.86, radius, shaftH, 16, 4), lambert(STONE), 0, height * 0.035 + shaftH / 2, 0));
  if (broken === null) {
    const top = height * 0.035 + shaftH;
    g.add(mesh(new THREE.CylinderGeometry(radius * 1.25, radius * 0.86, height * 0.03, 16), lambert(STONE), 0, top + height * 0.015, 0));
    g.add(mesh(new THREE.BoxGeometry(radius * 2.7, height * 0.035, radius * 2.7), lambert(STONE), 0, top + height * 0.047, 0));
  } else {
    // Rotura: un cono truncado inclinado simula el borde quebrado.
    const jag = mesh(new THREE.CylinderGeometry(radius * 0.3, radius * 0.86, radius * 1.2, 7), lambert(STONE_PALE), 0, height * 0.035 + shaftH + radius * 0.4, 0);
    jag.rotation.set((rand() - 0.5) * 0.6, rand() * 3, (rand() - 0.5) * 0.6);
    g.add(jag);
  }
  return g;
}

/** Tambor de columna caído, tumbado en el suelo y medio hundido. */
export function drum(radius: number, length: number, rand: () => number): THREE.Mesh {
  const d = mesh(new THREE.CylinderGeometry(radius * 0.9, radius, length, 16), lambert(STONE), 0, radius * 0.75, 0);
  d.rotation.set(0, rand() * Math.PI, Math.PI / 2 + (rand() - 0.5) * 0.2);
  return d;
}

/**
 * Columnata circular con el techo abierto: arquitrabe solo entre columnas contiguas en pie (los huecos de las rotas
 * dejan ver el cielo). Los tambores de las rotas yacen hacia fuera.
 */
export function colonnadeRing(
  radius: number, count: number, height: number, columnRadius: number, seed: number, brokenRate = 0.25,
): Monument {
  const rand = rng(seed);
  const group = new THREE.Group();
  const obstacles: Monument['obstacles'] = [];
  const intact: boolean[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    const broken = rand() < brokenRate ? 0.2 + rand() * 0.5 : null;
    intact.push(broken === null);
    const c = column(height, columnRadius, broken, rand);
    c.position.set(x, 0, z);
    group.add(c);
    obstacles.push({ x, z, r: columnRadius * 1.45 });
    if (broken !== null) {
      const fall = drum(columnRadius, height * (0.15 + rand() * 0.15), rand);
      const out = radius + columnRadius * (2.5 + rand() * 3);
      fall.position.x = Math.cos(a + 0.04) * out;
      fall.position.z = Math.sin(a + 0.04) * out;
      group.add(fall);
    }
  }
  // Arquitrabe: bloques entre columnas en pie.
  const beamMat = lambert(STONE); // mismo tono que el fuste: una malla menos por lugar
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    if (!intact[i] || !intact[j]) continue;
    const a1 = (i / count) * Math.PI * 2;
    const a2 = (j / count) * Math.PI * 2;
    const mid = (a1 + (j === 0 ? Math.PI * 2 : a2)) / 2;
    const chord = 2 * radius * Math.sin(Math.PI / count);
    const beam = mesh(new THREE.BoxGeometry(chord + columnRadius * 1.6, height * 0.08, columnRadius * 2.4), beamMat,
      Math.cos(mid) * radius * Math.cos(Math.PI / count), height + height * 0.04, Math.sin(mid) * radius * Math.cos(Math.PI / count));
    beam.rotation.y = -mid + Math.PI / 2;
    group.add(beam);
  }
  return { group, obstacles, torches: [] };
}

/** Peristilo rectangular (templo sin techo) alrededor del centro: entrada en +Z, hacia el ágora. */
export function peristyle(width: number, depth: number, height: number, columnRadius: number, seed: number): Monument {
  const rand = rng(seed);
  const group = new THREE.Group();
  const obstacles: Monument['obstacles'] = [];
  const spacing = columnRadius * 5.2;
  const nx = Math.max(3, Math.round(width / spacing));
  const nz = Math.max(3, Math.round(depth / spacing));
  const spots: [number, number][] = [];
  for (let i = 0; i <= nx; i++) for (const z of [-depth / 2, depth / 2]) spots.push([-width / 2 + (i * width) / nx, z]);
  for (let i = 1; i < nz; i++) for (const x of [-width / 2, width / 2]) spots.push([x, -depth / 2 + (i * depth) / nz]);
  const doorway = (x: number, z: number) => z > 0 && Math.abs(x) < width * 0.22; // vano de entrada
  const beamMat = lambert(STONE);
  const standing: [number, number][] = [];
  for (const [x, z] of spots) {
    if (doorway(x, z)) continue;
    const broken = rand() < 0.22 ? 0.25 + rand() * 0.45 : null;
    const c = column(height, columnRadius, broken, rand);
    c.position.set(x, 0, z);
    group.add(c);
    obstacles.push({ x, z, r: columnRadius * 1.45 });
    if (broken === null) standing.push([x, z]);
    else {
      const fall = drum(columnRadius, height * 0.2, rand);
      fall.position.set(x + (rand() - 0.5) * columnRadius * 6, 0, z + Math.sign(z || 1) * columnRadius * (3 + rand() * 3));
      group.add(fall);
    }
  }
  // Arquitrabes de los lados largos donde quedan columnas en pie en los extremos (techo abierto).
  for (const z of [-depth / 2, depth / 2]) {
    const row = standing.filter(([, sz]) => sz === z).map(([x]) => x).sort((a, b) => a - b);
    for (let i = 0; i + 1 < row.length; i++) {
      const a = row[i]!;
      const b = row[i + 1]!;
      if (b - a > spacing * 1.6) continue;
      group.add(mesh(new THREE.BoxGeometry(b - a + columnRadius * 1.6, height * 0.08, columnRadius * 2.4), beamMat, (a + b) / 2, height * 1.04, z));
    }
  }
  return { group, obstacles, torches: [new THREE.Vector3(-width * 0.3, 0, depth / 2 + columnRadius * 4), new THREE.Vector3(width * 0.3, 0, depth / 2 + columnRadius * 4)] };
}

/** Gradas que bajan por el borde de la isla (la superficie pisable sigue en y = 0). */
export function steppedRim(radius: number, steps = 3): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < steps; i++) {
    const r = radius + i * 1.4;
    const step = mesh(new THREE.CylinderGeometry(r + 1.4, r + 1.4, 0.7, Math.max(24, Math.round(r))), lambert(STONE_DARK), 0, -0.35 - i * 0.7, 0);
    step.userData['ground'] = true;
    g.add(step);
  }
  return g;
}

/** Estatua colosal derruida: cabeza, torso o mano, inclinada y medio hundida en la piedra. */
export function fallenStatue(kind: 'head' | 'torso' | 'hand', size: number, seed: number): THREE.Group {
  const rand = rng(seed);
  const g = new THREE.Group();
  const stone = lambert(STONE_PALE);
  const dark = lambert(STONE_DARK);
  if (kind === 'head') {
    const skull = mesh(new THREE.SphereGeometry(size, 14, 10), stone, 0, size * 0.7, 0);
    skull.scale.set(0.85, 1.05, 0.95);
    g.add(skull);
    g.add(mesh(new THREE.SphereGeometry(size * 0.95, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), dark, 0, size * 0.85, -size * 0.05)); // cabello
    g.add(mesh(new THREE.ConeGeometry(size * 0.16, size * 0.42, 5), stone, 0, size * 0.62, size * 0.92).rotateX(Math.PI / 2)); // nariz
    g.add(mesh(new THREE.BoxGeometry(size * 0.75, size * 0.09, size * 0.12), dark, 0, size * 0.92, size * 0.8)); // cejas
    g.add(mesh(new THREE.CylinderGeometry(size * 0.45, size * 0.55, size * 0.6, 10), stone, 0, -size * 0.1, -size * 0.1)); // cuello roto
    g.rotation.set(-0.5 - rand() * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.8);
    g.position.y = -size * 0.15;
  } else if (kind === 'torso') {
    g.add(mesh(new THREE.CylinderGeometry(size * 0.8, size * 0.6, size * 2, 10), stone, 0, size, 0));
    g.add(mesh(new THREE.SphereGeometry(size * 0.55, 10, 8), stone, size * 0.85, size * 1.8, 0));
    g.add(mesh(new THREE.SphereGeometry(size * 0.55, 10, 8), stone, -size * 0.85, size * 1.8, 0));
    g.add(mesh(new THREE.CylinderGeometry(size * 0.38, size * 0.42, size * 1.3, 8), stone, size * 1.1, size * 1.1, 0).rotateZ(0.25));
    g.add(mesh(new THREE.BoxGeometry(size * 1.9, size * 0.35, size * 1.3), dark, 0, size * 0.1, 0)); // pliegues
    g.rotation.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, Math.PI / 2 - 0.25);
    g.position.y = size * 0.55;
  } else {
    g.add(mesh(new THREE.BoxGeometry(size * 1.2, size * 0.45, size * 1.4), stone, 0, size * 0.22, 0));
    for (let i = 0; i < 4; i++) {
      const f = mesh(new THREE.CylinderGeometry(size * 0.13, size * 0.15, size * (0.9 + (i % 2) * 0.25), 7), stone, -size * 0.45 + i * size * 0.3, size * 0.5, size * 0.9);
      f.rotation.x = 1.2 + rand() * 0.4;
      g.add(f);
    }
    g.add(mesh(new THREE.CylinderGeometry(size * 0.15, size * 0.17, size * 0.8, 7), stone, size * 0.75, size * 0.3, size * 0.1).rotateZ(1.1));
    g.rotation.set(0.2, rand() * Math.PI * 2, -0.3);
  }
  return g;
}

/** Une varios monumentos en uno (grupo, obstáculos y antorchas), con un desplazamiento opcional. */
export function compose(parts: (Monument & { at?: THREE.Vector3; rotation?: number })[]): Monument {
  const group = new THREE.Group();
  const obstacles: Monument['obstacles'] = [];
  const torches: THREE.Vector3[] = [];
  for (const p of parts) {
    const at = p.at ?? new THREE.Vector3();
    const rot = p.rotation ?? 0;
    p.group.position.add(at);
    p.group.rotation.y += rot;
    group.add(p.group);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (const o of p.obstacles) obstacles.push({ x: at.x + o.x * c + o.z * s, z: at.z - o.x * s + o.z * c, r: o.r });
    for (const t of p.torches) torches.push(new THREE.Vector3(at.x + t.x * c + t.z * s, at.y + t.y, at.z - t.x * s + t.z * c));
  }
  return { group, obstacles, torches };
}

export { PALETTE };
