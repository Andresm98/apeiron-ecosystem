import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { type ClipKey, actionStates, findClip, strideOf, upperBodyOnly } from './gltf-clips.ts';

const track = (bone: string) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
const clip = (name: string, bones: string[], duration = 1) => new THREE.AnimationClip(name, duration, bones.map(track));

test('findClip ignores case and the Mixamo armature prefix', () => {
  const clips = [clip('Armature|Walk', ['Hips']), clip('idle', ['Hips']), clip('Wave', ['RightArm'])];
  assert.equal(findClip(clips, 'Walk')?.name, 'Armature|Walk');
  assert.equal(findClip(clips, 'Idle')?.name, 'idle');
  assert.equal(findClip(clips, 'Run'), null);
});

test('gesture clips keep arms, spine and head but drop hips and legs (Mixamo and our rig)', () => {
  const wave = clip('Wave', ['mixamorigHips', 'mixamorigSpine', 'mixamorigRightArm', 'mixamorigLeftUpLeg', 'mixamorigLeftFoot', 'thigh.L', 'head']);
  const upper = upperBodyOnly(wave);
  assert.deepEqual(upper.tracks.map((t) => t.name.split('.')[0]), ['mixamorigSpine', 'mixamorigRightArm', 'head']);
  assert.equal(upper.duration, wave.duration);
});

test('actionStates syncs walk and run to the phase and falls back when clips are missing', () => {
  const all = new Set<ClipKey>(['idle', 'walk', 'run', 'jump', 'wave']);
  const weights = { idle: 0, walk: 0.4, run: 0.6, jump: 0, phase: 0.25, air: 0, gesture: { name: 'wave' as const, weight: 1, progress: 0.5 } };
  const states = actionStates(weights, all, { walk: 1.2, run: 0.8, wave: 2 });
  assert.deepEqual(states.walk, { weight: 0.4, time: 0.3 });
  assert.deepEqual(states.run, { weight: 0.6, time: 0.2 });
  assert.deepEqual(states.wave, { weight: 1, time: 1 });
  // Sin clip de correr: su peso va a caminar; sin salto: al reposo; sin el gesto: no se inventa.
  const minimal = new Set<ClipKey>(['idle', 'walk']);
  const fallback = actionStates({ ...weights, jump: 0.5 }, minimal, { walk: 1 });
  assert.equal(fallback.walk?.weight, 1);
  assert.equal(fallback.idle?.weight, 0.5);
  assert.equal(fallback.wave, undefined);
});

test('the jump clip follows the flight: take-off, apex and landing map to its start, middle and end', () => {
  const air = (a: number) => ({ idle: 0, walk: 0, run: 0, jump: 1, phase: 0, air: a, gesture: null });
  const available = new Set<ClipKey>(['idle', 'walk', 'jump']);
  assert.deepEqual(actionStates(air(0), available, { jump: 0.6 }).jump, { weight: 1, time: 0 });
  assert.equal(actionStates(air(0.5), available, { jump: 0.6 }).jump?.time, 0.3);
  assert.equal(actionStates(air(1), available, { jump: 0.6 }).jump?.time, 0.6);
});

test('strideOf reads the stride the glb declares, in model heights, and runs on the walk cycle without Run', () => {
  assert.deepEqual(strideOf({ apeiron: { stride: { walk: 0.96 } } }, 2.5, false), { walk: 2.4, run: 2.4 });
  assert.deepEqual(strideOf({ apeiron: { stride: { walk: 0.96, run: 1.6 } } }, 2.5, true), { walk: 2.4, run: 4 });
  assert.equal(strideOf({ apeiron: { stride: { walk: 0.96 } } }, 2.5, true)?.run, 4); // Run sin zancada: la proporción del rig
  assert.equal(strideOf({}, 2.5, false), undefined);
  assert.equal(strideOf({ apeiron: { stride: { walk: 'x' } } }, 2.5, false), undefined);
});
