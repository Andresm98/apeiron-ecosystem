import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatEvent } from '../../research/domain/chat.ts';
import type { AgentInfo } from '../../research/domain/topology.ts';
import { cancelRun, failRun, reduceRunEvent, startRun } from '../../research/application/run-state.ts';
import {
  AGORA_ID, HOME_ID, SANCTUARY, WORLD_SCALE, agoraSeats, arrivalPoint, hostSpot, isWalkable, layoutCity, nearestPlace,
  toPlaceSpace, toolPlaceId,
} from './city-layout.ts';
import { citizenState, citizenStates, coreState, participants } from './citizen-state.ts';
import { EMPTY_CURSOR, readSignals } from './signals.ts';

const agent = (name: string, tools: string[] = [], kind: AgentInfo['kind'] = 'local'): AgentInfo => ({
  name, role: `rol de ${name}`, tools, kind,
});
// Como los publica la API: nombre visible y residencia salen del manifiesto de cada agente (ADR-013, catálogo de agentes).
const TWO: AgentInfo[] = [
  {
    ...agent('anaximandro', ['formal_logic_calculator', 'scholarly_search']), display_name: 'Anaximandro',
    residence: { title: 'El Gnomon', subtitle: 'Primeros principios', landmark: 'gnomon', color: '#d9a441' },
  },
  {
    ...agent('heraclito', ['vector_memory_retriever']), display_name: 'Heráclito',
    residence: { title: 'El Fuego y el Río', subtitle: 'Cambio', landmark: 'fire', color: '#e0663a', epithet: 'Todo fluye' },
  },
];
const replay = (events: ChatEvent[]) => events.reduce(reduceRunEvent, startRun());
const node = (name: string, status: 'start' | 'end', error = false): ChatEvent => ({ type: 'node', data: { node: name, status, error } });
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

test('layoutCity builds the agora, home, the tool buildings in use and one place per agent', () => {
  const places = layoutCity(TWO);
  const ids = places.map((p) => p.id);
  assert.deepEqual(ids, [AGORA_ID, HOME_ID, 'biblioteca', 'abaco', 'mnemosine', 'archivo', 'faro', 'anaximandro', 'heraclito']);
  const heraclito = places.find((p) => p.id === 'heraclito');
  assert.equal(heraclito?.title, 'El Fuego y el Río');
  assert.equal(heraclito?.color, '#e0663a');
  assert.equal(heraclito?.epithet, 'Todo fluye');
  assert.equal(places.find((p) => p.id === 'anaximandro')?.landmark, 'gnomon');
  // Sin agentes que la usen, una herramienta no tiene edificio.
  assert.deepEqual(layoutCity([agent('heraclito', ['vector_memory_retriever'])]).filter((p) => p.kind === 'tool').map((p) => p.id), ['mnemosine']);
});

test('layoutCity is deterministic and never overlaps islands, with 2, 5 and 6 agents', () => {
  const five = ['anaximandro', 'heraclito', 'nietzsche', 'feynman', 'epicuro'].map((n) => agent(n, ['scholarly_search']));
  const six = [...five, agent('socrates')];
  for (const roster of [TWO, five, six]) {
    const places = layoutCity(roster);
    assert.deepEqual(places, layoutCity(roster));
    for (const [i, a] of places.entries()) {
      for (const b of places.slice(i + 1)) {
        assert.ok(distance(a, b) > a.radius + b.radius, `${a.id} solapa con ${b.id}`);
      }
    }
  }
  const sixth = layoutCity(six).find((p) => p.id === 'socrates');
  assert.equal(sixth?.landmark, 'temple');
  assert.equal(sixth?.title, 'Templo de Socrates');
});

test('a manifest cannot ask for a silhouette or colour the engine does not know', () => {
  const odd: AgentInfo = {
    ...agent('socrates'), display_name: 'Sócrates',
    residence: { title: '', subtitle: '', landmark: 'castillo', color: 'red' },
  };
  const place = layoutCity([odd]).find((p) => p.id === 'socrates');
  assert.equal(place?.landmark, 'temple');
  assert.equal(place?.title, 'Templo de Sócrates'); // usa el nombre visible del manifiesto
  assert.match(place?.color ?? '', /^#[0-9a-f]{6}$/i);
});

test('remote agents live in a port on the edge of the city', () => {
  const places = layoutCity([...TWO, { ...agent('oraculo', [], 'remote'), endpoint: 'oraculo.example.org' }]);
  const port = places.find((p) => p.id === 'oraculo');
  assert.equal(port?.kind, 'foreign');
  assert.match(port?.subtitle ?? '', /A2A · oraculo\.example\.org/);
  const farthestLocal = Math.max(...places.filter((p) => p.kind === 'agent').map((p) => distance(p, { x: 0, z: 0 })));
  assert.ok(distance(port!, { x: 0, z: 0 }) > farthestLocal);
});

test('tools map to their building and agora seats fit inside the agora', () => {
  assert.equal(toolPlaceId('mcp_public_api_tool'), 'biblioteca');
  assert.equal(toolPlaceId('formal_logic_calculator'), 'abaco');
  assert.equal(toolPlaceId('desconocida'), null);
  const seats = agoraSeats(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(Object.keys(seats).length, 6);
  const agora = layoutCity(TWO).find((p) => p.id === AGORA_ID)!;
  for (const seat of Object.values(seats)) assert.ok(distance(seat, { x: 0, z: 0 }) < agora.radius * 0.6, 'cerca de la bema');
});

test('citizen states follow real node events', () => {
  let run = replay([node('apeiron_router', 'start'), node('apeiron_router', 'end'), node('anaximandro', 'start')]);
  assert.equal(citizenState(run, 'anaximandro'), 'working');
  assert.equal(coreState(run), 'supervising');
  run = reduceRunEvent(run, node('anaximandro/act', 'start'));
  assert.equal(citizenState(run, 'anaximandro'), 'using_tool');
  run = [node('anaximandro/act', 'end'), { type: 'turn', data: { agent: 'anaximandro', round: 0, text: 't' } } as ChatEvent, node('anaximandro', 'end')]
    .reduce(reduceRunEvent, run);
  assert.equal(citizenState(run, 'anaximandro'), 'done');
  assert.equal(citizenState(run, 'heraclito'), 'idle');
  run = reduceRunEvent(run, node('apeiron_synthesis', 'start'));
  assert.equal(coreState(run), 'synthesizing');
});

test('a degraded turn and a failed node are visible', () => {
  const run = replay([
    node('heraclito', 'start'),
    { type: 'turn', data: { agent: 'heraclito', round: 0, text: 'no disponible', degraded: true } },
    node('heraclito', 'end'),
    node('anaximandro', 'start'),
    node('anaximandro', 'end', true),
  ]);
  assert.deepEqual(citizenStates(run, ['heraclito', 'anaximandro']), { heraclito: 'degraded', anaximandro: 'error' });
});

test('cancelling, failing or losing the connection never leaves a citizen working', () => {
  const running = replay([node('heraclito', 'start'), node('heraclito/act', 'start')]);
  assert.equal(citizenState(cancelRun(running), 'heraclito'), 'idle');
  assert.equal(citizenState(failRun(running, 'Failed to fetch'), 'heraclito'), 'error');
  const server = reduceRunEvent(running, { type: 'error', data: { message: 'internal_error' } });
  assert.equal(citizenState(server, 'heraclito'), 'error');
  assert.equal(coreState(server), 'error');
});

test('participants come from the supervisor edges, in order of first appearance', () => {
  const run = replay([
    node('apeiron_router', 'start'), node('anaximandro', 'start'), node('apeiron_supervisor', 'start'),
    node('heraclito', 'start'), node('apeiron_supervisor', 'start'), node('anaximandro', 'start'),
  ]);
  assert.deepEqual(participants(run, ['anaximandro', 'heraclito', 'epicuro']), ['anaximandro', 'heraclito']);
});

test('readSignals separates control, speech, replies, tools and guardrails and reads each item once', () => {
  let run = replay([node('apeiron_router', 'start'), node('anaximandro', 'start')]);
  let read = readSignals(run, EMPTY_CURSOR);
  assert.deepEqual(read.signals, [{ kind: 'control', to: 'anaximandro' }]);

  run = [
    { type: 'step', data: { agent: 'anaximandro', round: 0, step: 1, tool: 'scholarly_search', input: 'q', observation: 'o', error: false } } as ChatEvent,
    { type: 'turn', data: { agent: 'anaximandro', round: 0, text: 'a' } } as ChatEvent,
    node('apeiron_supervisor', 'start'),
    node('heraclito', 'start'),
    { type: 'turn', data: { agent: 'heraclito', round: 0, text: 'b', responds_to: 'anaximandro' } } as ChatEvent,
    { type: 'guard', data: { stage: 'turn', action: 'redact', rules: ['unsupported_citation'], agent: 'heraclito', round: 0 } } as ChatEvent,
  ].reduce(reduceRunEvent, run);
  read = readSignals(run, read.cursor);
  assert.deepEqual(read.signals, [
    { kind: 'control', to: 'heraclito' },
    { kind: 'speech', agent: 'anaximandro', text: 'a' },
    { kind: 'speech', agent: 'heraclito', text: 'b' },
    { kind: 'reply', from: 'heraclito', to: 'anaximandro' },
    { kind: 'tool', agent: 'anaximandro', tool: 'scholarly_search', error: false },
    { kind: 'guard', agent: 'heraclito' },
  ]);
  assert.deepEqual(readSignals(run, read.cursor).signals, []);
});

test('readSignals starts over when a new run replaces the previous one', () => {
  const first = replay([node('apeiron_router', 'start'), node('anaximandro', 'start'), node('apeiron_supervisor', 'start')]);
  const { cursor } = readSignals(first, EMPTY_CURSOR);
  const second = replay([node('apeiron_router', 'start'), node('heraclito', 'start')]);
  assert.deepEqual(readSignals(second, cursor).signals, [{ kind: 'control', to: 'heraclito' }]);
});

test('ssanax walks on islands and bridges, never into the void or through monuments', () => {
  const places = layoutCity(TWO);
  const home = places.find((p) => p.id === HOME_ID)!;
  const gnomon = places.find((p) => p.id === 'anaximandro')!;
  assert.ok(isWalkable(places, home.x + 3 * WORLD_SCALE, home.z)); // en la isla de la casa, junto a la puerta
  assert.ok(!isWalkable(places, home.x, home.z)); // dentro de la casa
  assert.ok(isWalkable(places, gnomon.x * 0.6, gnomon.z * 0.6)); // sobre el puente del Gnomon
  assert.ok(!isWalkable(places, 600, 600)); // el vacío
  assert.ok(!isWalkable(places, 0, 0)); // la tribuna del ágora
  for (const p of places) assert.ok(isWalkable(places, arrivalPoint(p).x, arrivalPoint(p).z), `llegada a ${p.id}`);
});

test('an agent sanctuary blocks its temple and monument but not the way to its host', () => {
  const places = layoutCity(TWO);
  for (const p of places.filter((q) => q.kind === 'agent')) {
    const d = Math.hypot(p.x, p.z);
    // Espacio de la isla → ciudad: +Z hacia el ágora, +X a su derecha (el giro con el que la orienta el motor).
    const at = (x: number, z: number) => ({ x: p.x + x * (-p.z / d) + z * (-p.x / d), z: p.z + x * (p.x / d) + z * (-p.z / d) });
    const ok = (x: number, z: number) => isWalkable(places, at(x, z).x, at(x, z).z);
    const { temple, emblem, hostZ } = SANCTUARY;
    assert.ok(!ok(0, temple.z), `${p.id}: dentro del templo`);
    assert.ok(!ok(temple.halfWidth - 1, temple.z - temple.halfDepth + 1), `${p.id}: esquina trasera del templo`);
    assert.ok(!ok(0, emblem.z), `${p.id}: dentro del monumento`);
    assert.ok(ok(0, (temple.z + temple.halfDepth + emblem.z - emblem.radius) / 2), `${p.id}: entre la escalinata y el monumento`);
    assert.ok(ok(temple.halfWidth + 3, temple.z), `${p.id}: el paseo junto al templo`);
    assert.ok(ok(0, hostZ), `${p.id}: el anfitrión espera en suelo pisable`);
    const host = hostSpot(p);
    assert.ok(distance(host, at(0, hostZ)) < 0.05, `${p.id}: el anfitrión, delante del monumento`);
    assert.ok(distance(host, { x: 0, z: 0 }) < d, `${p.id}: el anfitrión, del lado del ágora`);
    const back = toPlaceSpace(p, at(2, -5).x, at(2, -5).z);
    assert.ok(Math.abs(back.x - 2) < 1e-9 && Math.abs(back.z + 5) < 1e-9, `${p.id}: ida y vuelta al espacio de la isla`);
  }
});

test('every bridge is walkable end to end, whatever the roster', () => {
  const five = ['anaximandro', 'heraclito', 'nietzsche', 'feynman', 'epicuro'].map((n) => agent(n, ['scholarly_search', 'formal_logic_calculator', 'vector_memory_retriever']));
  const rosters = [TWO, five, [...five, agent('socrates')], [...TWO, agent('oraculo', [], 'remote'), agent('pitia', [], 'remote')]];
  for (const roster of rosters) {
    const places = layoutCity(roster);
    for (const p of places.filter((q) => q.kind !== 'agora')) {
      const d = Math.hypot(p.x, p.z);
      // Del borde del ágora al borde de la isla, cada medio metro.
      const from = places.find((q) => q.kind === 'agora')!.radius + 0.5;
      for (let t = from; t <= d - p.radius * 0.7; t += 0.5) {
        assert.ok(isWalkable(places, (p.x * t) / d, (p.z * t) / d), `puente a ${p.id} cortado en ${t.toFixed(1)}`);
      }
    }
  }
});

test('nearestPlace picks the closest place within reach', () => {
  const places = layoutCity(TWO);
  const fire = places.find((p) => p.id === 'heraclito')!;
  assert.equal(nearestPlace(places, fire.x, fire.z - fire.radius - 1)?.id, 'heraclito');
  assert.equal(nearestPlace(places, 30, 30), null);
});
