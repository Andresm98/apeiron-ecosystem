import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutCity } from '../../../domain/city-layout.ts';
import { planLandmark, type SceneNode } from '../../../domain/landmark-conventions.ts';
import { RapierPhysics, toCity } from './rapier.ts';
import { Walkable2D } from './walkable-2d.ts';
import type { PolisPhysics } from './walkable.ts';

const node = (name: string, position: [number, number, number], halfExtents: [number, number, number]): SceneNode => ({
  name, position, rotation: [0, 0, 0, 1], scale: [1, 1, 1], halfExtents, isMesh: true,
});

// Un landmark con un muro al sur de su centro y un sensor al norte, con nombres de Blender.
const plan = planLandmark(
  [node('node_fixed_muro_box', [0, 1, 3], [2, 1, 0.5]), node('node_sensor_tribune', [0, 1, -3], [1, 1, 1])],
  { apeiron: { landmark: 'agora', version: 1 } },
);
const open: PolisPhysics = { move: (f, d) => ({ x: f.x + d.x, z: f.z + d.z }), sensors: () => [], dispose: () => undefined };

test('toCity rotates around Y like Three.js and then translates', () => {
  assert.deepEqual(toCity({ x: 10, z: 0, rotationY: 0 }, [0, 1, 3]), [10, 1, 3]);
  const [x, y, z] = toCity({ x: 10, z: 0, rotationY: Math.PI / 2 }, [0, 1, 3]);
  assert.ok(Math.abs(x - 13) < 1e-9 && y === 1 && Math.abs(z) < 1e-9);
});

test('Rapier builds fixed colliders from fixed_* names and stops ssanax at the wall', async () => {
  const physics = await RapierPhysics.create([{ placeId: 'agora', plan, x: 10, z: 0, rotationY: 0 }], open);
  try {
    assert.equal(physics.colliderCount, 1);
    let at = { x: 10, z: 0 };
    for (let i = 0; i < 20; i++) at = physics.move(at, { x: 0, z: 0.25 }); // intenta avanzar 5 m hacia el muro
    assert.ok(at.z > 1.5 && at.z < 2.2, `se detiene ante el muro (z=${at.z})`);
    const side = physics.move({ x: 10, z: 0 }, { x: 1, z: 0 });
    assert.ok(Math.abs(side.x - 11) < 0.01, 'en paralelo al muro camina libre');
    assert.deepEqual(physics.sensors({ x: 10, z: -3 }), ['agora:tribune']);
    assert.deepEqual(physics.sensors({ x: 10, z: 0 }), []);
  } finally {
    physics.dispose();
  }
});

test('the landmark rotation decided by the city layout also turns its colliders', async () => {
  const physics = await RapierPhysics.create([{ placeId: 'agora', plan, x: 10, z: 0, rotationY: Math.PI / 2 }], open);
  try {
    let at = { x: 10, z: 0 };
    for (let i = 0; i < 20; i++) at = physics.move(at, { x: 0.25, z: 0 });
    assert.ok(at.x > 11.5 && at.x < 12.2, `el muro girado está ahora al este (x=${at.x})`);
  } finally {
    physics.dispose();
  }
});

test('the 2D ground still vetoes water: Rapier never lets ssanax leave islands and bridges', async () => {
  const places = layoutCity([{ name: 'heraclito', role: 'r', tools: [], kind: 'local' }]);
  const ground = new Walkable2D(() => places);
  const physics = await RapierPhysics.create([], ground);
  try {
    assert.deepEqual(physics.move({ x: 0, z: 2 }, { x: 0, z: 0.5 }), ground.move({ x: 0, z: 2 }, { x: 0, z: 0.5 }));
    const edge = physics.move({ x: 9.5, z: 0.4 }, { x: 5, z: 0 }); // del ágora hacia el agua
    assert.deepEqual(edge, ground.move({ x: 9.5, z: 0.4 }, { x: 5, z: 0 }));
  } finally {
    physics.dispose();
  }
});

test('Walkable2D walks around architectural obstacles and never traps whoever starts inside one', () => {
  const places = layoutCity([{ name: 'heraclito', role: 'r', tools: [], kind: 'local' }]);
  const agora = places.find((p) => p.kind === 'agora')!;
  const column = { x: agora.radius * 0.6, z: 0, r: 2 };
  const ground = new Walkable2D(() => places, () => [column]);
  const before = { x: column.x - 3, z: 0 };
  assert.deepEqual(ground.move(before, { x: 2, z: 0 }), before, 'no atraviesa la columna');
  assert.deepEqual(ground.move(before, { x: 0, z: 1 }), { x: before.x, z: 1 }, 'la rodea');
  const inside = { x: column.x + 0.5, z: 0 };
  assert.deepEqual(ground.move(inside, { x: 0.5, z: 0 }), { x: inside.x + 0.5, z: 0 }, 'sale si aparece dentro');
});
