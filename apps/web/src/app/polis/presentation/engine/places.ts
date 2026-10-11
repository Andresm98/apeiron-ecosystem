import * as THREE from 'three';
import { PALETTE, agentTone } from '../../domain/atmosphere';
import { BEMA_RADIUS, BRIDGE_WIDTH, Place, WORLD_SCALE } from '../../domain/city-layout';
import { energyStone, tileUv } from './cosmos/energy';
import {
  Monument, altar, colonnadeRing, compose, drum, fallenStatue, peristyle, rng, seedOf, steppedRim,
} from './monuments';
import { batchStatic } from './world/batching';

/** Lugar construido: grupo seleccionable y, si tiene partes vivas, su animación ambiental. */
export interface BuiltPlace {
  place: Place;
  group: THREE.Group;
  /** Altura sobre la que flota el rótulo del lugar. */
  labelHeight: number;
  animate?: (t: number) => void;
  /** Núcleo de Ápeiron (solo el ágora): su brillo refleja el estado del orquestador. */
  core?: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshLambertMaterial>;
  /** Luz del Faro: su color refleja la salud del sistema (`/v1/system`). */
  lamp?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>;
  /** Columnas, altares y estatuas que ssanax rodea (círculos en coordenadas de la ciudad). */
  obstacles: { x: number; z: number; r: number }[];
  /** Antorchas del lugar (base, en coordenadas de la ciudad). */
  torches: THREE.Vector3[];
}

type Shape = Omit<BuiltPlace, 'obstacles' | 'torches'>;
type Builder = (place: Place) => Shape;

// La Polis en penumbra (ADR-013 §5.1): piedra erosionada, musgo, madera oscura y óxido.
const STONE = PALETTE.stoneLight;
const STONE_DARK = PALETTE.stone;
const ROCK = PALETTE.stoneWet;
const GRASS = PALETTE.moss;
const WOOD = PALETTE.wood;
const WALL = '#6f685c';
/** Color de un agente en su monumento: siempre en reposo; el color pleno es para su luz y su halo al actuar. */
const tone = (place: Place) => agentTone(place.color, false);

export const lambert = (color: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

/** Marca una pieza animada: el lote estático no la fusiona (ver `world/batching.ts`). */
function dynamic<T extends THREE.Object3D>(o: T): T {
  o.userData['dynamic'] = true;
  return o;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

function column(height: number, radius = 0.32): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(radius, radius * 1.1, height, 7), lambert(STONE), 0, height / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(radius * 2.8, 0.28, radius * 2.8), lambert(STONE_DARK), 0, height + 0.14, 0));
  return g;
}

function ring<T extends THREE.Object3D>(count: number, radius: number, make: (i: number) => T, start = 0): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = start + (i * 2 * Math.PI) / count;
    const o = make(i);
    o.position.x += radius * Math.cos(a);
    o.position.z += radius * Math.sin(a);
    g.add(o);
  }
  return g;
}

/** Color de la energía de las grietas: dorada en el ágora (el logos), la del agente en su santuario, cian en el resto. */
function energyOf(place: Place): string {
  if (place.kind === 'agora') return PALETTE.logos;
  if (place.kind === 'agent') return agentTone(place.color, true);
  return place.kind === 'foreign' ? PALETTE.energyViolet : PALETTE.energy;
}

/**
 * Isla flotante sobre el vacío cósmico: losa de piedra con grietas de energía (la superficie pisable queda en
 * y = 0) y una panza de roca escarpada con cristales luminosos.
 */
export function buildIsland(place: Place): THREE.Group {
  const g = new THREE.Group();
  const r = place.radius;
  const sides = Math.max(18, Math.round(r * 1.2));
  const slab = new THREE.CylinderGeometry(r, r * 0.97, 1.2, sides);
  tileUv(slab, r / 9, r / 9);
  const top = mesh(slab, energyStone(place.kind === 'agora' ? '#7d7668' : '#47444f', energyOf(place), place.kind === 'agora' ? 1.6 : 1.3, 0.9), 0, -0.6, 0);
  top.userData['ground'] = true;
  g.add(top);
  // Panza: roca escarpada (vértices desplazados de forma determinista) que se estrecha hacia abajo.
  const rand = rng(seedOf(`isla:${place.id}`));
  const belly = new THREE.CylinderGeometry(r * 0.98, r * 0.12, r * 1.25, sides, 7);
  const pos = belly.getAttribute('position') as THREE.BufferAttribute;
  const top0 = r * 0.625;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > top0 - 0.01) continue; // el borde superior encaja con la losa
    const k = 0.82 + rand() * 0.3;
    pos.setXYZ(i, pos.getX(i) * k, y - rand() * r * 0.08, pos.getZ(i) * k);
  }
  belly.computeVertexNormals();
  const rock = mesh(belly, lambert('#2e2b35'), 0, -1.2 - r * 0.625, 0);
  rock.rotation.y = rand() * Math.PI;
  rock.userData['ground'] = true;
  g.add(rock);
  // Cristales de energía incrustados en la panza.
  const crystal = new THREE.MeshBasicMaterial({ color: new THREE.Color(energyOf(place)).multiplyScalar(2.2) });
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2;
    const depth = 0.15 + rand() * 0.6;
    const c = mesh(new THREE.OctahedronGeometry(0.8 + rand() * 1.6, 0), crystal,
      Math.cos(a) * r * (0.92 - depth * 0.7), -1.5 - depth * r * 1.1, Math.sin(a) * r * (0.92 - depth * 0.7));
    c.scale.set(0.6, 2.4, 0.6);
    c.rotation.set(rand(), rand() * 3, rand());
    c.userData['ground'] = true;
    g.add(c);
  }
  return g;
}

/**
 * Calzada del borde del ágora al de la isla: losa con grietas por las que fluye energía estelar hacia el ágora y
 * pretiles de piedra a ambos lados.
 */
export function buildBridge(place: Place, agoraRadius: number): THREE.Group {
  const d = Math.hypot(place.x, place.z);
  const start = agoraRadius - 1;
  const end = d - place.radius + 1;
  const length = Math.max(0.1, end - start);
  const g = new THREE.Group();
  const slab = new THREE.BoxGeometry(BRIDGE_WIDTH, 1.2, length);
  tileUv(slab, 1, length / 14);
  const deck = mesh(slab, energyStone('#3c3a45', PALETTE.energy, 2.4, 1.8), 0, -0.6, 0);
  deck.userData['ground'] = true;
  g.add(deck);
  for (const side of [-1, 1]) {
    const curb = mesh(new THREE.BoxGeometry(0.7, 1.1, length), lambert('#55515c'), side * (BRIDGE_WIDTH / 2 + 0.35), 0.15, 0);
    curb.userData['ground'] = true;
    g.add(curb);
  }
  // Quilla bajo la calzada: le da peso de obra ciclópea vista desde abajo.
  const keel = mesh(new THREE.BoxGeometry(BRIDGE_WIDTH * 0.5, 3, length), lambert('#2e2b35'), 0, -2.6, 0);
  keel.userData['ground'] = true;
  g.add(keel);
  const mid = start + length / 2;
  g.position.set((place.x / d) * mid, 0, (place.z / d) * mid);
  g.rotation.y = Math.atan2(place.x, place.z);
  return g;
}

/**
 * Ágora: tholos colosal de 28 columnas de 22 m con el techo abierto al cosmos, bema en el centro y, flotando a
 * 30 m, el núcleo de Ápeiron con su anillo orbital. Lo que significa algo brilla; lo demás es piedra en penumbra.
 */
function agora(place: Place): Shape {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(BEMA_RADIUS, BEMA_RADIUS * 1.08, 1.4, 24), lambert('#8d8574'), 0, 0.7, 0));
  g.add(mesh(new THREE.CylinderGeometry(BEMA_RADIUS * 0.55, BEMA_RADIUS * 0.6, 1.2, 16), lambert('#6d675c'), 0, 2, 0));
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.6, 0),
    lambert(PALETTE.logos, { emissive: PALETTE.logos, emissiveIntensity: 0.5 }),
  );
  core.position.y = 30;
  g.add(dynamic(core));
  const orbit = mesh(new THREE.TorusGeometry(9, 0.25, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.logos).multiplyScalar(1.8) }), 0, 30, 0);
  orbit.rotation.x = Math.PI / 2 - 0.35;
  g.add(dynamic(orbit));
  return {
    place, group: g, labelHeight: 16, core,
    animate: (t) => {
      core.rotation.y = t * 0.3;
      core.position.y = 30 + Math.sin(t * 0.9) * 0.8;
      orbit.rotation.z = t * 0.15;
    },
  };
}

function gnomon(place: Place): Shape {
  const g = new THREE.Group();
  const dial = mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.3, 16), lambert(STONE), 0, 0.15, 0);
  const obelisk = mesh(new THREE.CylinderGeometry(0.15, 0.7, 7, 4), lambert(tone(place)), 0, 3.8, 0);
  obelisk.rotation.y = Math.PI / 4;
  g.add(dial, obelisk);
  // Marcas horarias.
  g.add(ring(12, 2.9, () => mesh(new THREE.BoxGeometry(0.12, 0.08, 0.6), lambert(STONE_DARK), 0, 0.34, 0)));
  // Sombra del gnomon: gira con el tiempo.
  const shadow = mesh(new THREE.BoxGeometry(0.25, 0.04, 3), lambert(PALETTE.abyss), 0, 0.33, 1.5);
  const pivot = dynamic(new THREE.Group());
  pivot.add(shadow);
  g.add(pivot);
  return { place, group: g, labelHeight: 9, animate: (t) => (pivot.rotation.y = t * 0.05) };
}

function fire(place: Place): Shape {
  const g = new THREE.Group();
  const river = mesh(new THREE.TorusGeometry(5.2, 0.55, 3, 30), lambert('#2b4a4f', { emissive: '#0e2a30', emissiveIntensity: 0.5 }), 0, 0.02, 0);
  river.rotation.x = Math.PI / 2;
  const brazier = mesh(new THREE.CylinderGeometry(1.4, 0.9, 1.4, 8), lambert(PALETTE.rust), 0, 0.7, 0);
  const flame = mesh(new THREE.ConeGeometry(0.9, 2.6, 6), lambert('#ff8a3d', { emissive: '#ff6a1f', emissiveIntensity: 2.6 }), 0, 2.7, 0);
  const inner = mesh(new THREE.ConeGeometry(0.5, 1.6, 5), lambert('#ffd98a', { emissive: '#ffc04d', emissiveIntensity: 3.2 }), 0, 2.3, 0);
  g.add(dynamic(river), brazier, dynamic(flame), dynamic(inner));
  return {
    place, group: g, labelHeight: 6.5,
    animate: (t) => {
      flame.scale.set(1 + Math.sin(t * 9) * 0.08, 1 + Math.sin(t * 7.3) * 0.15, 1 + Math.cos(t * 8.1) * 0.08);
      flame.rotation.y = t * 1.5;
      inner.rotation.y = -t * 2;
      river.rotation.z = t * 0.15;
    },
  };
}

function summit(place: Place): Shape {
  const g = new THREE.Group();
  g.add(mesh(new THREE.ConeGeometry(2.6, 6.5, 6), lambert(STONE_DARK), 0, 3.25, 0));
  g.add(mesh(new THREE.ConeGeometry(1.05, 2.2, 6), lambert(STONE), 0, 5.4, 0));
  g.add(mesh(new THREE.DodecahedronGeometry(1.1, 0), lambert(ROCK), 2.3, 0.6, 1));
  g.add(mesh(new THREE.DodecahedronGeometry(0.8, 0), lambert(ROCK), -2.1, 0.4, -1.2));
  g.add(mesh(new THREE.OctahedronGeometry(0.5, 0), lambert(tone(place), { emissive: place.color, emissiveIntensity: 0.6 }), 0, 7.3, 0));
  return { place, group: g, labelHeight: 9 };
}

function workshop(place: Place): Shape {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(4.2, 2.8, 3.2), lambert(WALL), 0, 1.4, 0));
  const roof = mesh(new THREE.CylinderGeometry(0.01, 3, 1.6, 4), lambert(tone(place)), 0, 3.6, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.05, 1, 0.8);
  g.add(roof, mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), lambert(ROCK), 1.3, 3.8, 0.6));
  g.add(mesh(new THREE.BoxGeometry(2.4, 1.4, 0.1), lambert(PALETTE.murk), 0, 1.6, 1.62)); // pizarra
  const atom = dynamic(new THREE.Group());
  for (let i = 0; i < 3; i++) {
    const orbit = mesh(new THREE.TorusGeometry(0.7, 0.04, 4, 20), lambert(tone(place), { emissive: place.color, emissiveIntensity: 0.5 }));
    orbit.rotation.set(i * 1.05, i * 0.6, 0);
    atom.add(orbit);
  }
  atom.position.y = 5.6;
  g.add(atom);
  return { place, group: g, labelHeight: 8, animate: (t) => (atom.rotation.y = t * 0.8) };
}

function garden(place: Place): Shape {
  const g = new THREE.Group();
  const tree = (h: number) => {
    const t = new THREE.Group();
    t.add(mesh(new THREE.CylinderGeometry(0.15, 0.22, h * 0.45, 5), lambert(WOOD), 0, h * 0.22, 0));
    t.add(mesh(new THREE.IcosahedronGeometry(h * 0.32, 0), lambert(tone(place)), 0, h * 0.6, 0));
    return t;
  };
  g.add(ring(5, 3.6, (i) => tree(2.6 + (i % 3) * 0.5), 0.4));
  g.add(mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.6, 8), lambert(STONE), 0, 0.3, 0));
  g.add(mesh(new THREE.SphereGeometry(0.5, 6, 5), lambert(PALETTE.lamp, { emissive: PALETTE.lamp, emissiveIntensity: 1.8 }), 0, 0.9, 0));
  return { place, group: g, labelHeight: 6 };
}

function temple(place: Place): Shape {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(5, 0.4, 3.6), lambert(STONE_DARK), 0, 0.2, 0));
  for (const x of [-2, -0.7, 0.7, 2]) for (const z of [-1.4, 1.4]) g.add(column(3.4, 0.25).translateX(x).translateZ(z).translateY(0.4));
  const roof = mesh(new THREE.CylinderGeometry(0.01, 2.2, 1.2, 3), lambert(tone(place)), 0, 4.6, 0);
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.scale.set(1, 2.6, 1);
  g.add(roof);
  return { place, group: g, labelHeight: 7 };
}

function port(place: Place): Shape {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(2, 0.3, 5), lambert(WOOD), 0, 0.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.2, 5, 5), lambert(WOOD), 0, 2.5, -1));
  const sail = mesh(new THREE.PlaneGeometry(2, 2.6), lambert('#8f887a', { side: THREE.DoubleSide }), 0.05, 3, -1);
  sail.rotation.y = Math.PI / 2;
  g.add(dynamic(sail));
  return { place, group: g, labelHeight: 6.5, animate: (t) => (sail.rotation.y = Math.PI / 2 + Math.sin(t * 0.8) * 0.15) };
}

function library(place: Place): Shape {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(6.4, 0.35, 2.8), lambert(STONE_DARK), 0, 0.17, 0));
  for (let i = 0; i < 6; i++) g.add(column(3, 0.24).translateX(-2.75 + i * 1.1).translateZ(1).translateY(0.35));
  g.add(mesh(new THREE.BoxGeometry(6.4, 2.9, 1.2), lambert(WALL), 0, 1.8, -0.7));
  g.add(mesh(new THREE.BoxGeometry(6.8, 0.4, 3), lambert(STONE), 0, 3.6, 0));
  return { place, group: g, labelHeight: 6 };
}

function abacus(place: Place): Shape {
  const g = new THREE.Group();
  const frame = lambert(WOOD);
  g.add(mesh(new THREE.BoxGeometry(0.25, 3.4, 0.25), frame, -1.8, 1.7, 0), mesh(new THREE.BoxGeometry(0.25, 3.4, 0.25), frame, 1.8, 1.7, 0));
  const beads: THREE.Mesh[] = [];
  for (let row = 0; row < 4; row++) {
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 4), lambert(STONE_DARK), 0, 0.8 + row * 0.75, 0).rotateZ(Math.PI / 2));
    for (let i = 0; i < 4; i++) {
      const bead = mesh(new THREE.SphereGeometry(0.22, 6, 4), lambert(i % 2 ? PALETTE.bronze : PALETTE.rustGrey), -1.2 + i * 0.55, 0.8 + row * 0.75, 0);
      beads.push(bead);
      g.add(dynamic(bead));
    }
  }
  return {
    place, group: g, labelHeight: 5.5,
    animate: (t) => beads.forEach((b, i) => (b.position.x = -1.2 + (i % 4) * 0.55 + Math.sin(t * 0.6 + i) * 0.12)),
  };
}

function well(place: Place): Shape {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.8, 2, 1, 10, 1, true), lambert(STONE, { side: THREE.DoubleSide }), 0, 0.5, 0));
  const water = mesh(new THREE.CircleGeometry(1.75, 10), lambert('#2b4a4f', { emissive: '#3d7f8c', emissiveIntensity: 0.6 }), 0, 0.75, 0);
  water.rotation.x = -Math.PI / 2;
  g.add(water);
  const orb = mesh(new THREE.IcosahedronGeometry(0.45, 0), lambert('#cfe6ee', { emissive: '#8fc7ea', emissiveIntensity: 2.2 }), 0, 2, 0);
  g.add(dynamic(orb));
  return { place, group: g, labelHeight: 5, animate: (t) => (orb.position.y = 2 + Math.sin(t * 1.4) * 0.3) };
}

function house(place: Place): Shape {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(3, 2.2, 3), lambert('#7a7264'), 0, 1.1, 0));
  const roof = mesh(new THREE.ConeGeometry(2.5, 1.5, 4), lambert(PALETTE.rust), 0, 2.95, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof, mesh(new THREE.BoxGeometry(0.8, 1.4, 0.1), lambert(WOOD), 0, 0.7, 1.52));
  return { place, group: g, labelHeight: 5 };
}

function archive(place: Place): Shape {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(4, 2.6, 3), lambert(WALL), 0, 1.3, 0));
  const roof = mesh(new THREE.CylinderGeometry(0.01, 2.6, 1.3, 4), lambert(PALETTE.bronze), 0, 3.25, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  // Rollos apilados delante de la puerta.
  for (let i = 0; i < 5; i++) {
    const scroll = mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.3, 6), lambert(i % 2 ? '#9b9180' : '#8a806f'));
    scroll.rotation.z = Math.PI / 2;
    scroll.position.set(-0.6 + (i % 3) * 0.6, 0.2 + Math.floor(i / 3) * 0.36, 1.9);
    g.add(scroll);
  }
  return { place, group: g, labelHeight: 5.5 };
}

function beacon(place: Place): Shape {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.9, 1.4, 7, 8), lambert(STONE), 0, 3.5, 0));
  for (const y of [2.2, 4.6]) g.add(mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.5, 8), lambert(PALETTE.rust), 0, y, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 8), lambert(STONE_DARK), 0, 7.15, 0));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), lambert('#cccccc', { emissive: '#888888', emissiveIntensity: 0.6 }));
  lamp.position.y = 7.9;
  const beam = mesh(new THREE.ConeGeometry(0.9, 6, 10, 1, true), new THREE.MeshBasicMaterial({
    color: PALETTE.lamp, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false,
  }), 0, 7.9, 0);
  beam.rotation.z = Math.PI / 2;
  const pivot = new THREE.Group();
  pivot.position.y = 0;
  pivot.add(beam);
  beam.position.set(3, 7.9, 0);
  g.add(dynamic(lamp), dynamic(pivot));
  return { place, group: g, labelHeight: 10, lamp, animate: (t) => (pivot.rotation.y = t * 0.6) };
}

const BUILDERS: Record<Place['landmark'], Builder> = {
  agora, gnomon, fire, summit, workshop, garden, temple, port, library, abacus, well, house, archive, beacon,
};

/**
 * Arquitectura monumental de cada lugar (espacio local, entrada en +Z hacia el ágora): el ágora es un tholos con
 * techo abierto; los santuarios de los agentes, peristilos sin techo con estatua derruida y altar; los edificios
 * menores, tholos de columnas.
 */
function architecture(place: Place): Monument {
  const r = place.radius;
  const seed = seedOf(place.id);
  const rand = rng(seed);
  const statueKind = (['head', 'torso', 'hand'] as const)[Math.floor(rand() * 3)]!;
  const aside = (angle: number, dist: number) => new THREE.Vector3(Math.sin(angle) * dist, 0, Math.cos(angle) * dist);
  if (place.kind === 'agora') {
    const ring = colonnadeRing(r - 4, 28, 22, 1.25, seed, 0.2);
    const torches = Array.from({ length: 4 }, (_, i) => aside((i / 4) * Math.PI * 2 + Math.PI / 4, BEMA_RADIUS + 5));
    return compose([
      ring,
      { group: steppedRim(r), obstacles: [], torches },
      { ...ring, group: new THREE.Group(), obstacles: [], torches: Array.from({ length: 4 }, (_, i) => aside((i / 4) * Math.PI * 2, r - 7)) },
    ]);
  }
  if (place.kind === 'agent') {
    const temple = peristyle(r * 0.9, r * 1.05, 15, 0.95, seed);
    const statue = fallenStatue(statueKind, 4.5, seed + 1);
    return compose([
      temple,
      { group: steppedRim(r), obstacles: [], torches: [] },
      { group: statue, obstacles: [{ x: 0, z: 0, r: 7 }], torches: [], at: aside(Math.PI * (0.55 + rand() * 0.9), r * 0.8) },
      { ...altar(1.4), at: aside(0, r * 0.38) },
    ]);
  }
  if (place.kind === 'foreign') {
    return compose([
      { group: new THREE.Group().add(drum(1, 6, rand)), obstacles: [{ x: 0, z: 0, r: 3 }], torches: [], at: aside(Math.PI * 0.8, r * 0.6) },
      { group: new THREE.Group(), obstacles: [], torches: [aside(-0.4, r * 0.75), aside(0.4, r * 0.75)] },
    ]);
  }
  const tholos = colonnadeRing(r * 0.62, place.kind === 'tool' ? 10 : 8, place.kind === 'beacon' ? 9 : 11, 0.7, seed, 0.3);
  return compose([
    tholos,
    { group: new THREE.Group(), obstacles: [], torches: [aside(-0.5, r * 0.5), aside(0.5, r * 0.5)] }, // dentro del tholos, flanqueando la entrada
    ...(place.kind === 'home' ? [] : [{ group: fallenStatue('hand', 2.6, seed + 2), obstacles: [{ x: 0, z: 0, r: 4 }], torches: [], at: aside(Math.PI * 0.9, r * 0.78) }]),
  ]);
}

/** Construye el lugar: monumento (ampliado a escala monumental), arquitectura e isla, orientado hacia el ágora. */
export function buildPlace(place: Place): BuiltPlace {
  const base = place.landmark === 'agora' ? agora(place) : BUILDERS[place.landmark](place);
  if (place.landmark !== 'agora') {
    // El monumento de cada lugar, modelado a escala humana, crece con la ciudad.
    const scaled = new THREE.Group();
    scaled.scale.setScalar(WORLD_SCALE);
    for (const child of [...base.group.children]) scaled.add(child);
    base.group.add(scaled);
    base.labelHeight = Math.min(base.labelHeight * WORLD_SCALE, 20);
  }
  const arch = architecture(place);
  base.group.add(arch.group, buildIsland(place));
  base.group.position.set(place.x, 0, place.z);
  if (place.kind !== 'agora') base.group.rotation.y = Math.atan2(-place.x, -place.z);
  base.group.traverse((o) => {
    o.userData['placeId'] = place.id;
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const transparent = (m.material as THREE.Material).transparent;
    // Sombras de la luna (según el nivel): todo proyecta y recibe salvo lo translúcido y el suelo.
    m.geometry.computeBoundingSphere();
    const tiny = (m.geometry.boundingSphere?.radius ?? 1) < 0.35;
    m.castShadow = !transparent && !m.userData['ground'] && !tiny;
    m.receiveShadow = true;
    // Lo que no es suelo puede tapar a ssanax: la cámara lo vuelve translúcido (oclusión, ver `world.ts`).
    if (!m.userData['ground'] && !transparent) m.userData['occluder'] = true;
  });
  batchStatic(base.group);
  // Obstáculos y antorchas a coordenadas de la ciudad (giro del lugar + posición).
  const yaw = base.group.rotation.y;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const toCity = (x: number, z: number) => ({ x: place.x + x * c + z * s, z: place.z - x * s + z * c });
  return {
    ...base,
    obstacles: arch.obstacles.map((o) => ({ ...toCity(o.x, o.z), r: o.r })),
    torches: arch.torches.map((t) => {
      const w = toCity(t.x, t.z);
      return new THREE.Vector3(w.x, t.y, w.z);
    }),
  };
}
