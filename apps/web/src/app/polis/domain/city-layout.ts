import { agentLabel, agentNames } from '../../research/domain/agent-label.ts';
import type { AgentInfo } from '../../research/domain/topology.ts';

/** Tipo de lugar de la Polis (ADR-013). */
export type PlaceKind = 'agora' | 'agent' | 'foreign' | 'tool' | 'home' | 'archive' | 'beacon';

/** Silueta que construye el motor para cada lugar. */
export type Landmark =
  | 'agora' | 'gnomon' | 'fire' | 'summit' | 'workshop' | 'garden' | 'temple' | 'port'
  | 'library' | 'abacus' | 'well' | 'house' | 'archive' | 'beacon';

export interface Place {
  id: string;
  kind: PlaceKind;
  landmark: Landmark;
  title: string;
  subtitle: string;
  /** Agente que vive aquí (lugares `agent` y `foreign`). */
  agent?: string;
  /** Herramientas servidas aquí (lugares `tool`). */
  tools?: string[];
  x: number;
  z: number;
  /** Radio de la isla: también es el radio de colisión. */
  radius: number;
  color: string;
  /** Una línea que presenta al agente al acercarse (de su manifiesto). */
  epithet?: string;
}

/** Siluetas que un manifiesto puede pedir para su residencia; cualquier otra se dibuja como templo. */
const AGENT_LANDMARKS: ReadonlySet<string> = new Set<Landmark>([
  'gnomon', 'fire', 'summit', 'workshop', 'garden', 'temple', 'library', 'abacus', 'well',
]);

const FALLBACK_COLORS = ['#c7889e', '#5fb3a1', '#b9a35b', '#7f8fd6'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;

interface Workshop { id: string; title: string; subtitle: string; landmark: Landmark; tools: string[]; }

/** Edificios de herramientas: un agente que usa una herramienta envía allí su mensajero. */
const WORKSHOPS: Workshop[] = [
  { id: 'biblioteca', title: 'Biblioteca', subtitle: 'Literatura académica y arXiv', landmark: 'library', tools: ['scholarly_search', 'mcp_public_api_tool'] },
  { id: 'abaco', title: 'El Ábaco', subtitle: 'Comprobación lógica', landmark: 'abacus', tools: ['formal_logic_calculator'] },
  { id: 'mnemosine', title: 'Mnemósine', subtitle: 'Memoria del usuario y conocimiento global', landmark: 'well', tools: ['vector_memory_retriever'] },
];

export const AGORA_ID = 'agora';
export const HOME_ID = 'casa';
export const ARCHIVE_ID = 'archivo';
export const BEACON_ID = 'faro';

/**
 * Escala monumental (ADR-013, «Polis cósmica»): ssanax mide 2,5 m y los santuarios se miden en decenas de metros.
 * Todo el trazado se multiplica por este factor; el núcleo jugable ocupa unos 0,3 km² y el escenario, con las
 * ruinas flotantes del horizonte, alrededor de 1 km².
 */
export const WORLD_SCALE = 3.3;
const S = WORLD_SCALE;

const AGORA_RADIUS = 11 * S;
const INNER_RING = 27 * S;
const OUTER_INNER_RING = 36 * S; // el Faro, algo apartado: se ve desde toda la ciudad
const AGENT_RING = 52 * S;
const FOREIGN_RING = 76 * S;
/** Radio de la bema (tribuna central del ágora): hasta su borde se adelanta quien tiene la palabra. */
export const BEMA_RADIUS = 2.4 * S;

const round = (n: number) => Math.round(n * 100) / 100;
const polar = (radius: number, angle: number) => ({ x: round(radius * Math.cos(angle)), z: round(radius * Math.sin(angle)) });

/** Lugar del edificio que sirve una herramienta, o null si ninguno la sirve. */
export function toolPlaceId(tool: string): string | null {
  return WORKSHOPS.find((w) => w.tools.includes(tool))?.id ?? null;
}

/**
 * Trazado de la ciudad a partir de la topología publicada por la API. Ágora en el centro; la casa de ssanax y
 * los edificios de herramientas en el anillo interior; los agentes locales en el anillo medio y los remotos (A2A)
 * como forasteros en el borde. Determinista: la misma topología produce la misma ciudad. La casa lleva el nombre
 * del jugador (`player`), que no cambia el trazado.
 */
export function layoutCity(agents: AgentInfo[], player = 'ssanax'): Place[] {
  const names = agentNames(agents);
  const places: Place[] = [
    {
      id: AGORA_ID, kind: 'agora', landmark: 'agora', title: 'Ágora', subtitle: 'Ápeiron convoca, modera y sintetiza',
      x: 0, z: 0, radius: AGORA_RADIUS, color: '#e8dcc0',
    },
  ];

  const locals = agents.filter((a) => a.kind !== 'remote');
  const remotes = agents.filter((a) => a.kind === 'remote');
  const used = new Set(agents.flatMap((a) => a.tools));
  const workshops = WORKSHOPS.filter((w) => w.tools.some((t) => used.has(t)));

  // Cada lugar se une al ágora por un puente radial. Los ángulos se eligen lejos de los ya ocupados para que
  // ningún monumento caiga sobre el puente de otro lugar. El primer agente queda al norte (-z).
  const taken = locals.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(locals.length, 1));
  const remoteAngles = remotes.map(() => claimAngle(taken, -Math.PI / 2 + Math.PI / Math.max(locals.length, 1)));
  const homeAngle = claimAngle(taken, Math.PI / 2); // la casa, preferentemente al sur, frente al primer agente
  const workshopAngles = workshops.map(() => claimAngle(taken, Math.PI));
  const archiveAngle = claimAngle(taken, (3 * Math.PI) / 4);
  const beaconAngle = claimAngle(taken, Math.PI / 4);

  places.push({
    id: HOME_ID, kind: 'home', landmark: 'house', title: `Casa de ${player}`, subtitle: 'Tu punto de partida',
    ...polar(INNER_RING, homeAngle), radius: 4.5 * S, color: '#f2efe6',
  });
  workshops.forEach((w, i) => {
    places.push({
      id: w.id, kind: 'tool', landmark: w.landmark, title: w.title, subtitle: w.subtitle, tools: w.tools,
      ...polar(INNER_RING, workshopAngles[i]!), radius: 5.5 * S, color: '#cfc6b4',
    });
  });
  // Fase 4: el Archivo guarda las crónicas (historial y replay) y el Faro muestra la salud del sistema.
  places.push({
    id: ARCHIVE_ID, kind: 'archive', landmark: 'archive', title: 'Archivo', subtitle: 'Crónicas de debates pasados',
    ...polar(INNER_RING, archiveAngle), radius: 5 * S, color: '#c9b38a',
  });
  places.push({
    id: BEACON_ID, kind: 'beacon', landmark: 'beacon', title: 'El Faro', subtitle: 'Salud de la polis',
    ...polar(OUTER_INNER_RING, beaconAngle), radius: 4.5 * S, color: '#e8e4da',
  });
  // La residencia de cada agente la declara su manifiesto (ADR-013, catálogo de agentes): la ciudad no conoce a ningún agente.
  locals.forEach((a, i) => {
    const home = a.residence;
    const label = agentLabel(a.name, names);
    places.push({
      id: a.name, kind: 'agent', agent: a.name,
      landmark: home && AGENT_LANDMARKS.has(home.landmark) ? (home.landmark as Landmark) : 'temple',
      title: home?.title || `Templo de ${label}`,
      subtitle: home?.subtitle || a.role,
      ...polar(AGENT_RING, taken[i]!),
      radius: 8 * S,
      color: home && COLOR_RE.test(home.color) ? home.color : FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
      ...(home?.epithet ? { epithet: home.epithet } : {}),
    });
  });
  remotes.forEach((a, i) => {
    places.push({
      id: a.name, kind: 'foreign', agent: a.name, landmark: 'port',
      title: `Puerto de ${agentLabel(a.name, names)}`, subtitle: `Forastero vía A2A${a.endpoint ? ` · ${a.endpoint}` : ''}`,
      ...polar(FOREIGN_RING, remoteAngles[i]!),
      radius: 6 * S,
      color: '#9aa7b0',
    });
  });
  return places;
}

const ANGLE_CANDIDATES = Array.from({ length: 72 }, (_, i) => (i * Math.PI) / 36); // cada 5°

function angularGap(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
}

/** Ocupa el ángulo más alejado de los ya tomados; a igualdad, el más cercano al preferido. Determinista. */
function claimAngle(taken: number[], preferred: number): number {
  let best = preferred;
  let bestScore = -Infinity;
  for (const angle of ANGLE_CANDIDATES) {
    const clearance = taken.length ? Math.min(...taken.map((t) => angularGap(angle, t))) : Math.PI;
    const score = Math.round(clearance * 1000) - angularGap(angle, preferred) / 10;
    if (score > bestScore) {
      best = angle;
      bestScore = score;
    }
  }
  taken.push(best);
  return best;
}

/** Asientos del ágora para los convocados: un círculo cerca de la bema (no en el borde del ágora: a esta escala no se oirían). */
export function agoraSeats(agents: string[]): Record<string, { x: number; z: number }> {
  const seats: Record<string, { x: number; z: number }> = {};
  agents.forEach((name, i) => {
    seats[name] = polar(BEMA_RADIUS * 2.2, -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(agents.length, 1));
  });
  return seats;
}

/** Ancho de los puentes que unen cada isla con el ágora. */
export const BRIDGE_WIDTH = 2 * S;
/** Radio del monumento central de cada isla: no se atraviesa. */
const MONUMENT_RADIUS: Partial<Record<PlaceKind, number>> = {
  agora: BEMA_RADIUS, agent: 2.4 * S, foreign: 1.8 * S, tool: 2.6 * S, home: 2 * S, archive: 2.2 * S, beacon: 1.6 * S,
};

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Suelo pisable: dentro de una isla o sobre un puente al ágora, y fuera de los monumentos. */
export function isWalkable(places: Place[], x: number, z: number): boolean {
  const onIsland = places.some((p) => Math.hypot(x - p.x, z - p.z) <= p.radius - 0.6);
  const onBridge = places.some(
    (p) => p.kind !== 'agora' && distanceToSegment(x, z, 0, 0, p.x, p.z) <= BRIDGE_WIDTH / 2 - 0.3,
  );
  if (!onIsland && !onBridge) return false;
  return !places.some((p) => Math.hypot(x - p.x, z - p.z) < (MONUMENT_RADIUS[p.kind] ?? 0));
}

/** Lugar con el que se puede interactuar desde (x, z): el más cercano a menos de su radio + 4 m. */
export function nearestPlace(places: Place[], x: number, z: number): Place | null {
  let best: Place | null = null;
  let bestGap = Infinity;
  for (const p of places) {
    const gap = Math.hypot(x - p.x, z - p.z) - p.radius;
    if (gap < 4 && gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Punto de llegada al viajar a un lugar: en su borde, del lado del ágora pero girado 40° respecto al puente, para
 * que ssanax no quede delante del anfitrión (que espera sobre ese eje) ni detrás de su monumento.
 */
export function arrivalPoint(place: Place): { x: number; z: number } {
  const toAgora = Math.hypot(place.x, place.z) === 0 ? Math.PI / 2 : Math.atan2(-place.z, -place.x);
  const angle = toAgora + 0.7;
  return { x: round(place.x + place.radius * 0.72 * Math.cos(angle)), z: round(place.z + place.radius * 0.72 * Math.sin(angle)) };
}
