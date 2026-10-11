import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentStep, Turn } from '../../research/domain/chat.ts';
import { HOME_ID, layoutCity } from './city-layout.ts';
import { HUMAN, defaultDraft } from './deliberation.ts';
import {
  LABEL_FAR, LABEL_NEAR, PRESETS, announcement, applyPreset, chronicle, controlHints, countdown, headingDeg, labelOpacity, linkLabel, moved,
  presetOf, progressLine, resumable, roster,
} from './hud.ts';

const label = (a: string) => (a === HUMAN ? 'ssanax' : a[0]!.toUpperCase() + a.slice(1));

test('presets change pace and duration but never the chosen participants', () => {
  const draft = defaultDraft(['heraclito', HUMAN]);
  for (const { id } of PRESETS) {
    const applied = applyPreset(draft, id);
    assert.deepEqual(applied.participants, ['heraclito', HUMAN]);
    assert.equal(presetOf(applied), id);
  }
  assert.equal(applyPreset(draft, 'seminar').pace, 'step');
  assert.equal(applyPreset(draft, 'assembly').openEnded, true);
  assert.equal(presetOf({ ...applyPreset(draft, 'quick'), rounds: 3 }), null); // personalizado
});

test('countdown turns urgent in the last 30 seconds and never leaves [0, 1]', () => {
  assert.equal(countdown(null, 240), null);
  assert.deepEqual(countdown(120, 240), { text: '2:00', fraction: 0.5, urgent: false });
  assert.equal(countdown(30, 240)!.urgent, true);
  assert.equal(countdown(0, 240)!.fraction, 0);
  assert.equal(countdown(300, 240)!.fraction, 1); // un plazo que crece no desborda el anillo
  assert.equal(countdown(90, null)!.fraction, 1); // reanudada: sin plazo total conocido
});

test('progressLine shows round, next speaker and remaining budget', () => {
  assert.equal(progressLine({ round: 1, maxRounds: 3, next: 'heraclito', budgetLeft: 250 }, label), 'Ronda 2 de 3 · siguiente: Heraclito · quedan 4:10');
  assert.equal(progressLine({ round: 4, openEnded: true }, label), 'Ronda 5 · debate abierto');
  assert.equal(progressLine({ round: 0 }, label), 'Ronda 1');
  assert.equal(progressLine({ round: 3, maxRounds: 3 }, label), 'Ronda 3 de 3'); // la síntesis no es otra ronda
  assert.equal(progressLine({}, label), '');
});

test('chronicle keeps whole turns, replies, tools per round and the synthesis', () => {
  const long = 'x'.repeat(900);
  const turns: Turn[] = [
    { agent: 'anaximandro', round: 0, text: long },
    { agent: HUMAN, round: 0, text: 'Yo digo', responds_to: 'anaximandro' },
    { agent: 'anaximandro', round: 1, text: 'b', responds_to: 'anaximandro', degraded: true },
  ];
  const step = (agent: string, round: number, tool: string): AgentStep =>
    ({ agent, round, step: 1, tool, input: '', observation: '', error: false });
  const steps = [step('anaximandro', 0, 'scholarly_search'), step('anaximandro', 0, 'scholarly_search'), step('anaximandro', 1, 'formal_logic_calculator')];
  const entries = chronicle(turns, steps, 'Síntesis');
  assert.equal(entries.length, 4);
  assert.deepEqual(entries[0], { kind: 'turn', agent: 'anaximandro', round: 0, text: long, respondsTo: null, degraded: false, tools: ['scholarly_search'] });
  assert.equal((entries[1] as { respondsTo: string }).respondsTo, 'anaximandro');
  assert.equal((entries[2] as { respondsTo: string | null }).respondsTo, null); // responderse a sí mismo no es réplica
  assert.deepEqual((entries[2] as { tools: string[] }).tools, ['formal_logic_calculator']);
  assert.deepEqual(entries[3], { kind: 'synthesis', text: 'Síntesis' });
  assert.equal(chronicle([], [], '').length, 0);
});

test('announcement is short and never repeats the turn text', () => {
  const [turn, mine, synthesis] = chronicle(
    [{ agent: 'heraclito', round: 0, text: 'secreto largo' }, { agent: HUMAN, round: 0, text: 'mío', responds_to: 'heraclito' }], [], 'fin',
  );
  assert.equal(announcement(turn, label), 'Heraclito ha hablado.');
  assert.equal(announcement(mine, label), 'Has hablado, en respuesta a Heraclito.');
  assert.equal(announcement(synthesis, label), 'Ápeiron ha sintetizado la deliberación.');
  assert.equal(announcement(undefined, label), '');
});

test('roster lists every citizen with state, presence in the agora and next speaker', () => {
  const entries = roster(['anaximandro', 'heraclito', 'epicuro'], { heraclito: 'working' }, ['heraclito', HUMAN], 'anaximandro');
  assert.deepEqual(entries.map((e) => [e.name, e.state, e.inAgora, e.next]), [
    ['anaximandro', 'idle', false, true], ['heraclito', 'working', true, false], ['epicuro', 'idle', false, false],
  ]);
});

test('place labels fade with distance and the near or hovered one stays sharp', () => {
  const mid = (LABEL_NEAR + LABEL_FAR) / 2;
  assert.equal(labelOpacity(LABEL_NEAR / 2, false), 0.9);
  assert.ok(labelOpacity(mid, false) > 0 && labelOpacity(mid, false) < 0.9);
  assert.ok(labelOpacity(mid + 10, false) < labelOpacity(mid, false));
  assert.equal(labelOpacity(LABEL_FAR + 10, false), 0);
  assert.equal(labelOpacity(LABEL_FAR + 10, true), 1);
});

test('headingDeg points the minimap arrow where the camera walks', () => {
  assert.equal(headingDeg(0), 0); // avanza hacia -z: arriba en el mapa
  assert.equal(headingDeg(-Math.PI / 2), 90); // hacia +x: derecha
  assert.equal(headingDeg(Math.PI / 2), 270);
  assert.equal(headingDeg(Math.PI), 180);
  assert.equal(headingDeg(4 * Math.PI), 0);
});

test('moved filters out position updates that would not change the minimap', () => {
  const at = { x: 1, z: 1, heading: 10 };
  assert.equal(moved(null, at), true);
  assert.equal(moved(at, { x: 1.01, z: 1, heading: 10.2 }), false);
  assert.equal(moved(at, { x: 1.5, z: 1, heading: 10 }), true);
  assert.equal(moved(at, { x: 1, z: 1, heading: 14 }), true);
});

test('controlHints depend on the pointer: joystick on touch, keys on desktop', () => {
  assert.ok(controlHints(true).some((h) => h.keys === 'Joystick'));
  assert.ok(!controlHints(true).some((h) => h.keys === 'E'));
  assert.ok(controlHints(false).some((h) => h.keys === 'E'));
});

test('linkLabel only speaks when the connection is not healthy', () => {
  assert.equal(linkLabel({ kind: 'online' }), null);
  assert.equal(linkLabel({ kind: 'retrying', attempt: 2, max: 6 }), 'Reconectando… intento 2/6');
  assert.match(linkLabel({ kind: 'lost' }) ?? '', /perdió/);
});

test('resumable offers the newest open session, dormant ones included', () => {
  assert.equal(resumable([]), null);
  const sessions = [
    { id: 'a', status: 'waiting' as const, question: 'q', created_at: 10 },
    { id: 'b', status: 'running' as const, question: 'q', created_at: 30, dormant: true },
    { id: 'c', status: 'completed' as const, question: 'q', created_at: 50 },
  ];
  assert.equal(resumable(sessions)?.id, 'b');
});

test('the home carries the player name without moving the city', () => {
  const agents = [{ name: 'heraclito', role: 'r', tools: [], kind: 'local' as const }];
  const mine = layoutCity(agents, 'andres');
  assert.equal(mine.find((p) => p.id === HOME_ID)?.title, 'Casa de andres');
  assert.deepEqual(mine.map((p) => [p.id, p.x, p.z]), layoutCity(agents).map((p) => [p.id, p.x, p.z]));
});

test('the default draft is the quick debate preset', () => {
  assert.equal(presetOf(defaultDraft(['heraclito'])), 'quick');
});
