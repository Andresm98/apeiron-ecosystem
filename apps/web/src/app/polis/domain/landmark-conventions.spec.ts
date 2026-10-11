import test from 'node:test';
import assert from 'node:assert/strict';
import { LOD_DISTANCES, classify, planLandmark, splitLod, type SceneNode } from './landmark-conventions.ts';

// Convenciones de nombres de los landmarks glTF ----------------------------------------------------

const node = (name: string, extra: Partial<SceneNode> = {}): SceneNode => ({
  name, position: [1, 0, 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1], halfExtents: [0.5, 1, 0.5], isMesh: true, ...extra,
});

test('classify reads Blender names with or without the node_ prefix', () => {
  assert.deepEqual(classify('node_fixed_muro_box'), { kind: 'fixed', id: 'muro', shape: 'box' });
  assert.deepEqual(classify('fixed_columna_cyl'), { kind: 'fixed', id: 'columna', shape: 'cylinder' });
  assert.deepEqual(classify('fixed_estatua'), { kind: 'fixed', id: 'estatua', shape: 'trimesh' });
  assert.deepEqual(classify('node_sensor_interact'), { kind: 'sensor', id: 'interact' });
  assert.deepEqual(classify('node_spawn_seat_3'), { kind: 'spawn', id: 'seat_3' });
  assert.deepEqual(classify('fixed_columna_cyl.004'), { kind: 'fixed', id: 'columna', shape: 'cylinder' }); // duplicado de Blender
  assert.deepEqual(classify('fixed_columna_lod1'), { kind: 'fixed', id: 'columna', shape: 'trimesh' });
  assert.deepEqual(classify('Escalinata'), { kind: 'visual' });
  assert.deepEqual(classify('node_columna'), { kind: 'visual' });
  assert.deepEqual(splitLod('tribuna_lod2'), { base: 'tribuna', lod: 2 });
  assert.deepEqual(LOD_DISTANCES, [0, 35, 70]);
});

test('planLandmark builds colliders, sensors, spawns and hidden helpers from names alone', () => {
  const plan = planLandmark([
    node('node_fixed_muro_box'),
    node('fixed_columna_cyl'),
    node('fixed_columna_cyl.001', { position: [3, 0, 0] }),
    node('fixed_estatua', { vertices: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) }),
    node('walk_suelo'),
    node('node_sensor_tribune'),
    node('spawn_host', { isMesh: false, halfExtents: [0, 0, 0] }),
    node('spawn_visitor', { isMesh: false }),
    node('spawn_seat_2', { isMesh: false }),
    node('spawn_seat_1', { isMesh: false }),
    node('light_lamp', { isMesh: false }),
    node('fx_smoke', { isMesh: false }),
    node('tribuna_lod0'), node('tribuna_lod1'), node('tribuna_lod2'),
    node('Escalinata'),
  ], { apeiron: { landmark: 'agora', version: 1, radius: 11 } }, 'agora');
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.radius, 11);
  assert.deepEqual(plan.colliders.map((c) => [c.id, c.shape]), [['muro', 'box'], ['columna', 'cylinder'], ['columna', 'cylinder'], ['estatua', 'trimesh']]);
  assert.equal(plan.walkables.length, 1);
  assert.deepEqual(plan.sensors.map((s) => s.id), ['tribune']);
  assert.equal(plan.spawns.host?.id, 'host');
  assert.deepEqual(plan.spawns.seats.map((s) => s.id), ['seat_1', 'seat_2']);
  assert.deepEqual(plan.lods, { tribuna: [0, 1, 2] });
  assert.ok(plan.hidden.includes('node_fixed_muro_box') && !plan.hidden.includes('fixed_estatua')); // el trimesh se ve
  assert.ok(!plan.hidden.includes('Escalinata'));
});

test('planLandmark reports what a modeller must fix instead of guessing', () => {
  const plan = planLandmark([
    node('fixed_estatua'), // trimesh sin geometría
    node('fixed_muro_box', { isMesh: false }),
    node('spawn_ventana', { isMesh: false }),
    node('sensor_interact'), node('sensor_interact.001'),
    node('tribuna_lod0'), node('tribuna_lod2'),
  ], { apeiron: { landmark: 'gnomon' } }, 'agora');
  assert.equal(plan.colliders.length, 0);
  const text = plan.problems.join('\n');
  for (const fragment of ['version', 'gnomon', 'trimesh', 'necesita una malla', 'spawn desconocido', 'duplicado', 'incompletos']) {
    assert.match(text, new RegExp(fragment));
  }
  assert.match(planLandmark([], {}).problems.join(), /landmark/);
});
