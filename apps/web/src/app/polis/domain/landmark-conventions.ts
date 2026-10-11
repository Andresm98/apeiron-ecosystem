/**
 * Convenciones de nombres de los landmarks glTF exportados desde Blender (ADR-013 §5.5, subfase 5c). El modelador
 * nombra los nodos y el motor deduce todo lo demás: geometría estática, colisionadores de Rapier, suelo pisable,
 * sensores, puntos de aparición, luces, anclas de efectos y niveles de detalle. Nada se posiciona a mano en código.
 *
 * Puro: trabaja sobre `SceneNode` (nodos ya aplanados a espacio del landmark), no sobre Three.js, para poder
 * probarlo sin WebGL.
 */

export type Vec3 = [number, number, number];
/** Cuaternión (x, y, z, w). */
export type Quat = [number, number, number, number];

/** Nodo del glTF aplanado: transformación en el espacio local del landmark (origen = centro de la isla). */
export interface SceneNode {
  name: string;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  /** Semiextensiones de la caja local de la malla ya escalada; [0, 0, 0] en un empty. */
  halfExtents: Vec3;
  isMesh: boolean;
  /** Vértices e índices en espacio del landmark, solo si el colisionador es una malla exacta (trimesh). */
  vertices?: Float32Array;
  indices?: Uint32Array;
}

export type ColliderShape = 'box' | 'cylinder' | 'trimesh';

export type NodeRole =
  | { kind: 'fixed'; id: string; shape: ColliderShape }
  | { kind: 'walk'; id: string }
  | { kind: 'sensor'; id: string }
  | { kind: 'spawn'; id: string }
  | { kind: 'light'; id: 'lamp' | 'core' | string }
  | { kind: 'fx'; id: 'smoke' | 'water' | 'fire' | string }
  | { kind: 'visual' };

/** Distancias de cambio de nivel de detalle: lod0 hasta 35 m, lod1 hasta 70 m, lod2 más allá. */
export const LOD_DISTANCES = [0, 35, 70] as const;

const LOD_RE = /_lod([0-2])$/;
const ROLE_RE = /^(?:node_)?(fixed|walk|sensor|spawn|light|fx)_(.+)$/;
const SHAPE_SUFFIX: Record<string, ColliderShape> = { box: 'box', cyl: 'cylinder' };

/** Separa el sufijo `_lodN` (Blender: `fixed_columna_lod1`). */
export function splitLod(name: string): { base: string; lod: number | null } {
  const match = LOD_RE.exec(name);
  return match ? { base: name.slice(0, match.index), lod: Number(match[1]) } : { base: name, lod: null };
}

/**
 * Rol de un nodo por su nombre. Acepta el prefijo opcional `node_` (`node_fixed_muro` = `fixed_muro`). Blender añade
 * `.001` a los duplicados: se ignora. Un nombre sin prefijo conocido es decoración.
 */
export function classify(rawName: string): NodeRole {
  const name = splitLod(rawName.replace(/\.\d{3}$/, '')).base;
  const match = ROLE_RE.exec(name);
  if (!match) return { kind: 'visual' };
  const [, prefix, rest] = match as unknown as [string, string, string];
  if (prefix === 'fixed') {
    const parts = rest.split('_');
    const shape = SHAPE_SUFFIX[parts.at(-1) ?? ''];
    return shape ? { kind: 'fixed', id: parts.slice(0, -1).join('_') || rest, shape } : { kind: 'fixed', id: rest, shape: 'trimesh' };
  }
  return { kind: prefix as 'walk' | 'sensor' | 'spawn' | 'light' | 'fx', id: rest };
}

export interface Anchor { id: string; position: Vec3; rotation: Quat; }
export interface Volume extends Anchor { halfExtents: Vec3; }
export interface FixedCollider extends Volume {
  shape: ColliderShape;
  vertices?: Float32Array;
  indices?: Uint32Array;
}

/** Lo que el motor necesita de un landmark, deducido solo de los nombres. */
export interface LandmarkPlan {
  landmark: string;
  version: number;
  /** Radio de la isla declarado en el asset (`extras.apeiron.radius`); null = el de la topología. */
  radius: number | null;
  colliders: FixedCollider[];
  walkables: Volume[];
  sensors: Volume[];
  spawns: { host: Anchor | null; visitor: Anchor | null; seats: Anchor[] };
  lights: Anchor[];
  fx: Anchor[];
  /** Nodos con niveles de detalle: nombre base → niveles presentes. */
  lods: Record<string, number[]>;
  /** Nodos que no se dibujan (colisionadores simplificados, sensores, suelo pisable y empties). */
  hidden: string[];
  problems: string[];
}

/** `extras` de la raíz del glTF (Blender: propiedades personalizadas de la escena). */
export interface LandmarkExtras { apeiron?: { landmark?: unknown; version?: unknown; radius?: unknown } }

const SEAT_RE = /^seat_(\d+)$/;

export function planLandmark(nodes: SceneNode[], extras: LandmarkExtras, expected?: string): LandmarkPlan {
  const meta = extras.apeiron ?? {};
  const plan: LandmarkPlan = {
    landmark: typeof meta.landmark === 'string' ? meta.landmark : '',
    version: typeof meta.version === 'number' ? meta.version : 0,
    radius: typeof meta.radius === 'number' && meta.radius > 0 ? meta.radius : null,
    colliders: [], walkables: [], sensors: [],
    spawns: { host: null, visitor: null, seats: [] },
    lights: [], fx: [], lods: {}, hidden: [], problems: [],
  };
  if (!plan.landmark) plan.problems.push('falta extras.apeiron.landmark en la raíz');
  if (expected && plan.landmark && plan.landmark !== expected) {
    plan.problems.push(`el asset dice ser «${plan.landmark}» y se cargó como «${expected}»`);
  }
  if (!plan.version) plan.problems.push('falta extras.apeiron.version');

  const seen = new Set<string>();
  for (const node of nodes) {
    const { base, lod } = splitLod(node.name.replace(/\.\d{3}$/, ''));
    if (lod !== null) {
      const levels = (plan.lods[base] ??= []);
      if (!levels.includes(lod)) levels.push(lod);
    }
    const role = classify(node.name);
    if (role.kind === 'visual') continue;
    // Las variantes LOD de un colisionador o sensor no crean otro cuerpo: solo cuenta lod0 (o sin sufijo).
    if (lod !== null && lod > 0) continue;
    const key = `${role.kind}:${'id' in role ? role.id : ''}`;
    if (seen.has(key) && role.kind !== 'fixed' && role.kind !== 'light' && role.kind !== 'fx') {
      plan.problems.push(`nombre duplicado: ${node.name}`);
      continue;
    }
    seen.add(key);
    const anchor: Anchor = { id: role.id, position: node.position, rotation: node.rotation };
    const volume: Volume = { ...anchor, halfExtents: node.halfExtents };
    switch (role.kind) {
      case 'fixed': {
        if (!node.isMesh) {
          plan.problems.push(`${node.name}: un colisionador necesita una malla`);
          continue;
        }
        if (role.shape === 'trimesh' && !(node.vertices && node.indices)) {
          plan.problems.push(`${node.name}: trimesh sin geometría; usa _box o _cyl`);
          continue;
        }
        plan.colliders.push({ ...volume, shape: role.shape, ...(role.shape === 'trimesh' ? { vertices: node.vertices!, indices: node.indices! } : {}) });
        // Un colisionador simplificado (_box/_cyl) es invisible; un trimesh es la propia geometría visible.
        if (role.shape !== 'trimesh') plan.hidden.push(node.name);
        break;
      }
      case 'walk':
        plan.walkables.push(volume);
        plan.hidden.push(node.name);
        break;
      case 'sensor':
        plan.sensors.push(volume);
        plan.hidden.push(node.name);
        break;
      case 'spawn': {
        if (role.id === 'host') plan.spawns.host = anchor;
        else if (role.id === 'visitor') plan.spawns.visitor = anchor;
        else if (SEAT_RE.test(role.id)) plan.spawns.seats.push(anchor);
        else plan.problems.push(`${node.name}: spawn desconocido (host, visitor o seat_N)`);
        plan.hidden.push(node.name);
        break;
      }
      case 'light':
        plan.lights.push(anchor);
        plan.hidden.push(node.name);
        break;
      case 'fx':
        plan.fx.push(anchor);
        plan.hidden.push(node.name);
        break;
    }
  }
  plan.spawns.seats.sort((a, b) => Number(SEAT_RE.exec(a.id)![1]) - Number(SEAT_RE.exec(b.id)![1]));
  for (const [base, levels] of Object.entries(plan.lods)) {
    levels.sort();
    if (levels[0] !== 0 || levels.some((l, i) => l !== i)) plan.problems.push(`${base}: niveles de detalle incompletos (${levels.join(', ')})`);
  }
  return plan;
}
