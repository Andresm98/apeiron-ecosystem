import test from 'node:test';
import assert from 'node:assert/strict';
import { Animator, type AnimatorInput, IDLE_VARIANT_AFTER_S, RUN_SPEED, WALK_SPEED } from './animator.ts';
import { GESTURE_SECONDS, bone, gesture, stride } from './clips.ts';
import { BONES, RIG, bindPosition } from './rig.ts';

const DT = 1 / 60;
const input = (over: Partial<AnimatorInput> = {}): AnimatorInput => ({
  dt: DT, speed: 0, grounded: true, vy: 0, thinking: false, talking: false, ...over,
});
function run(animator: Animator, seconds: number, over: Partial<AnimatorInput> = {}) {
  const frames = [];
  for (let t = 0; t < seconds; t += DT) frames.push(animator.update(input(over)));
  return frames;
}

test('the rig is a single tree, 2.5 m tall with hair, and symmetric', () => {
  const roots = BONES.filter((b) => RIG[b].parent === null);
  assert.deepEqual(roots, ['root']);
  const hairTop = bindPosition('hair')[1];
  assert.ok(hairTop > 2.1 && hairTop < 2.5, `pelo a ${hairTop} m`);
  assert.equal(bindPosition('hand.L')[0], -bindPosition('hand.R')[0]);
  assert.ok(Math.abs(bindPosition('foot.L')[1] - 0.1) < 1e-9, 'tobillos a 10 cm del suelo');
});

test('walking swings opposite legs and arms, and the hips dip on each footfall', () => {
  const p = stride(0.25, 0);
  assert.ok(bone(p, 'thigh.L')[0] < 0 && bone(p, 'thigh.R')[0] > 0, 'una pierna adelante, otra atrás');
  assert.ok(bone(p, 'upperArm.L')[0] > 0 && bone(p, 'upperArm.R')[0] < 0, 'brazos opuestos a sus piernas');
  assert.ok(stride(0.25, 0).hipsY < stride(0, 0).hipsY, 'la cadera baja con los pies separados');
  assert.ok(bone(stride(0.25, 1), 'spine')[0] > bone(stride(0.25, 0), 'spine')[0], 'al correr se inclina más');
});

test('feet do not slide: footsteps follow distance, not time', () => {
  const slow = run(new Animator(), 4, { speed: WALK_SPEED / 2 }).flatMap((f) => f.events).filter((e) => e.kind === 'step');
  const fast = run(new Animator(), 4, { speed: WALK_SPEED }).flatMap((f) => f.events).filter((e) => e.kind === 'step');
  assert.ok(slow.length >= 3, `pasos a media velocidad: ${slow.length}`);
  assert.ok(Math.abs(fast.length - slow.length * 2) <= 2, `doble velocidad, doble de pasos (${slow.length} → ${fast.length})`);
  const feet = fast.map((e) => (e.kind === 'step' ? e.foot : ''));
  assert.ok(feet.every((f, i) => i === 0 || f !== feet[i - 1]), 'alterna pies');
  assert.equal(run(new Animator(), 3).flatMap((f) => f.events).length, 0, 'quieto no hay pasos');
});

test('locomotion weights blend idle, walk and run by speed', () => {
  const w = (speed: number) => run(new Animator(), 0.2, { speed }).at(-1)!.weights;
  assert.equal(w(0).idle, 1);
  assert.ok(w(WALK_SPEED).walk > 0.99);
  assert.ok(w(RUN_SPEED).run > 0.99);
  const mid = w((WALK_SPEED + RUN_SPEED) / 2);
  assert.ok(mid.walk > 0.3 && mid.run > 0.3);
});

test('a jump tucks the legs in the air and lands with an impact event and a squash', () => {
  const animator = new Animator();
  run(animator, 0.2);
  const air = run(animator, 0.5, { grounded: false, vy: -7 }).at(-1)!;
  assert.equal(air.weights.jump, 1);
  assert.ok(bone(air.pose, 'shin.L')[0] > 0.8, 'rodilla recogida');
  const touch = animator.update(input());
  const land = touch.events.find((e) => e.kind === 'land');
  assert.ok(land && land.kind === 'land' && land.impact > 0.5);
  const squash = run(animator, 0.12).at(-1)!.pose.squash;
  assert.ok(squash > 0.05, `squash al aterrizar: ${squash}`);
  assert.ok(Math.abs(run(animator, 0.5).at(-1)!.pose.squash) < 0.01, 'y se recupera');
});

test('one-shot gestures fade in, only move the upper body, and finish on time', () => {
  const animator = new Animator();
  animator.play('wave');
  const frames = run(animator, GESTURE_SECONDS.wave! + 0.3, { speed: WALK_SPEED });
  const peak = Math.max(...frames.map((f) => f.weights.gesture?.weight ?? 0));
  assert.equal(peak, 1);
  const mid = frames[Math.round(frames.length / 2)]!;
  assert.ok(bone(mid.pose, 'upperArm.R')[2] < -1.5, 'brazo derecho en alto');
  const plain = stride(mid.weights.phase, 0);
  assert.deepEqual(bone(mid.pose, 'thigh.L'), bone(plain, 'thigh.L'), 'las piernas siguen caminando');
  assert.equal(frames.at(-1)!.weights.gesture, null, 'terminó');
});

test('talking beats thinking, a one-shot beats both, and loops resume afterwards', () => {
  const animator = new Animator();
  assert.equal(run(animator, 0.5, { thinking: true }).at(-1)!.weights.gesture?.name, 'think');
  assert.equal(run(animator, 0.5, { thinking: true, talking: true }).at(-1)!.weights.gesture?.name, 'talk');
  animator.play('shrug');
  assert.equal(run(animator, 0.3, { thinking: true }).at(-1)!.weights.gesture?.name, 'shrug');
  assert.equal(run(animator, GESTURE_SECONDS.shrug! + 0.5, { thinking: true }).at(-1)!.weights.gesture?.name, 'think');
  // Pensar solo estando quieto: al caminar se suelta la barbilla.
  const walking = run(animator, 0.6, { thinking: true, speed: WALK_SPEED }).at(-1)!;
  assert.ok(!walking.weights.gesture || walking.weights.gesture.weight < 0.01);
});

test('standing still for a while plays an idle variant, never while thinking', () => {
  const bored = run(new Animator(), IDLE_VARIANT_AFTER_S + 0.5);
  assert.ok(bored.some((f) => f.weights.gesture?.name === 'lookAround'));
  const busy = run(new Animator(), IDLE_VARIANT_AFTER_S + 0.5, { thinking: true });
  assert.ok(!busy.some((f) => f.weights.gesture?.name === 'lookAround'));
});

test('every gesture produces finite, bounded rotations', () => {
  for (const name of Object.keys(GESTURE_SECONDS) as (keyof typeof GESTURE_SECONDS)[]) {
    for (const u of [0, 0.25, 0.5, 1]) {
      for (const v of Object.values(gesture(name, 1.3, u).bones)) {
        assert.ok(v!.every((x) => Number.isFinite(x) && Math.abs(x) < Math.PI), `${name} u=${u}`);
      }
    }
  }
});

test('footfalls happen with the legs at full stride, on the foot that is in front', () => {
  const frames = run(new Animator(), 3, { speed: WALK_SPEED });
  const steps = frames.flatMap((f) => f.events.map((e) => ({ e, f })).filter(({ e }) => e.kind === 'step'));
  assert.ok(steps.length >= 4);
  for (const { e, f } of steps) {
    const front = bone(f.pose, 'thigh.L')[0] < bone(f.pose, 'thigh.R')[0] ? 'L' : 'R'; // −x = muslo adelante
    assert.equal(e.kind === 'step' && e.foot, front);
    assert.ok(Math.abs(Math.sin(2 * Math.PI * f.weights.phase)) > 0.9, `zancada completa (φ=${f.weights.phase.toFixed(2)})`);
  }
});
