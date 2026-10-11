import test from 'node:test';
import assert from 'node:assert/strict';
import { AWAKE_GLOW, AWAKE_LIFT, NOTICE_M, REST_GLOW, TRAVEL_LIFT, approach, attentionAt, statuePose } from './statue-motion.ts';

test('a resting statue stays on the ground, only breathes and is never a black silhouette', () => {
  for (const t of [0, 1.3, 7.9]) {
    const pose = statuePose('idle', false, t);
    assert.equal(pose.lift, 0);
    assert.equal(pose.glow, REST_GLOW);
    assert.ok(REST_GLOW > 0);
    assert.ok(Math.abs(pose.sway) <= 0.008);
  }
});

test('a travelling statue levitates and leans toward its destination instead of walking', () => {
  const pose = statuePose('idle', true, 2);
  assert.ok(Math.abs(pose.lift - TRAVEL_LIFT) <= 0.06);
  assert.ok(pose.lean > 0);
});

test('reasoning and tool use make the marble glow; tool use pulses faster', () => {
  const samples = (state: 'working' | 'using_tool') => Array.from({ length: 200 }, (_, i) => statuePose(state, false, i / 50).glow);
  for (const state of ['working', 'using_tool'] as const) {
    const glow = samples(state);
    assert.ok(Math.min(...glow) >= 0.4 && Math.max(...glow) <= 0.7, `${state}: brilla entre 0,4 y 0,7`);
    assert.ok(Math.min(...glow) > REST_GLOW + 0.1, `${state}: se distingue del reposo`);
    assert.ok(statuePose(state, false, 1).lift > 0.1, `${state}: flota`);
  }
  const crossings = (glow: number[]) => glow.slice(1).filter((g, i) => (g - 0.55) * (glow[i]! - 0.55) < 0).length;
  assert.ok(crossings(samples('using_tool')) > crossings(samples('working')));
});

test('finished states keep a faint glow, errors the strongest', () => {
  const glow = (s: 'done' | 'degraded' | 'error') => statuePose(s, false, 0).glow;
  assert.ok(glow('error') > glow('done') && glow('done') > glow('degraded') && glow('degraded') > REST_GLOW);
});

test('citizens breathe out of phase and transitions never jump', () => {
  assert.notEqual(statuePose('idle', false, 1, 0).sway, statuePose('idle', false, 1, 2).sway);
  assert.equal(approach(0, 1, 0), 0);
  const step = approach(0, 1, 1 / 60);
  assert.ok(step > 0 && step < 0.2);
  assert.ok(Math.abs(approach(0, 1, 10) - 1) < 1e-6);
});

test('a resting statue wakes up as ssanax approaches: it rises and lights up, gradually', () => {
  assert.equal(attentionAt(NOTICE_M + 5), 0);
  assert.equal(attentionAt(0), 1);
  assert.ok(attentionAt(10) > attentionAt(14) && attentionAt(14) > 0);
  const far = statuePose('idle', false, 1, 0, attentionAt(40));
  const near = statuePose('idle', false, 1, 0, attentionAt(3));
  assert.equal(far.lift, 0);
  assert.equal(far.glow, REST_GLOW);
  assert.ok(Math.abs(near.lift - AWAKE_LIFT) <= 0.04 && near.lift < TRAVEL_LIFT); // un palmo, menos que al viajar
  assert.ok(Math.abs(near.glow - AWAKE_GLOW) < 1e-9);
  const half = statuePose('idle', false, 1, 0, 0.5);
  assert.ok(half.glow > REST_GLOW && half.glow < AWAKE_GLOW);
});

test('attention never dims a statue that already glows more, nor changes a busy or travelling one', () => {
  assert.ok(statuePose('error', false, 1, 0, 1).glow >= statuePose('error', false, 1, 0, 0).glow);
  assert.deepEqual(statuePose('working', false, 1.2, 3, 1), statuePose('working', false, 1.2, 3, 0));
  assert.deepEqual(statuePose('idle', true, 1.2, 3, 1), statuePose('idle', true, 1.2, 3, 0));
});
