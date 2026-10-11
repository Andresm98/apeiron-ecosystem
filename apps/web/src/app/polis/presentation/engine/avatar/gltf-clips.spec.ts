import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { type ClipKey, actionStates, findClip, upperBodyOnly } from './gltf-clips.ts';

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
  const weights = { idle: 0, walk: 0.4, run: 0.6, jump: 0, phase: 0.25, gesture: { name: 'wave' as const, weight: 1, progress: 0.5 } };
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
