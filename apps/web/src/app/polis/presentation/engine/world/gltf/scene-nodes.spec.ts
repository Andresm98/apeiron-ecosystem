import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { planLandmark } from '../../../../domain/landmark-conventions.ts';
import { toSceneNodes } from './scene-nodes.ts';

const r = (values: number[], k = 1000) => values.map((v) => Math.round(v * k) / k + 0); // +0: sin -0

/** Una escena como la que entrega GLTFLoader tras exportar desde Blender (sin WebGL: solo el grafo). */
function blenderScene(): THREE.Group {
  const root = new THREE.Group();
  root.position.set(50, 0, 50); // la ciudad lo moverá; los nodos deben quedar en espacio del landmark
  root.rotation.y = 1.2;
  root.userData = { apeiron: { landmark: 'agora', version: 1, radius: 11 } };
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1), new THREE.MeshBasicMaterial());
  wall.name = 'node_fixed_muro_box';
  wall.position.set(0, 1, 3);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 4, 8), new THREE.MeshBasicMaterial());
  column.name = 'fixed_columna_cyl';
  column.position.set(-2, 2, 0);
  column.scale.set(1, 2, 1);
  const statue = new THREE.Mesh(new THREE.TetrahedronGeometry(1), new THREE.MeshBasicMaterial());
  statue.name = 'fixed_estatua';
  const host = new THREE.Object3D();
  host.name = 'node_spawn_host';
  host.position.set(0, 0, -4);
  const kit = new THREE.Group(); // jerarquía: Blender agrupa piezas en colecciones
  kit.position.set(1, 0, 0);
  const sensor = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  sensor.name = 'sensor_tribune';
  sensor.position.set(0, 1, 0);
  kit.add(sensor);
  root.add(wall, column, statue, host, kit);
  return root;
}

test('toSceneNodes flattens the hierarchy into landmark space with scaled extents', () => {
  const nodes = toSceneNodes(blenderScene());
  const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
  const wall = byName['node_fixed_muro_box']!;
  assert.deepEqual(r(wall.position), [0, 1, 3]); // la transformación de la raíz no cuenta
  assert.deepEqual(r(wall.halfExtents), [2, 1, 0.5]);
  assert.deepEqual(r(byName['fixed_columna_cyl']!.halfExtents, 100), [0.4, 4, 0.4]);
  assert.deepEqual(r(byName['sensor_tribune']!.position), [1, 1, 0]); // dentro del grupo
  assert.equal(byName['node_spawn_host']!.isMesh, false);
  const statue = byName['fixed_estatua']!;
  assert.ok(statue.vertices && statue.indices && statue.indices.length % 3 === 0, 'el trimesh trae geometría');
  assert.equal(byName['node_fixed_muro_box']!.vertices, undefined, 'un _box no copia vértices');
});

test('a Blender export becomes a complete landmark plan without placing anything by hand', () => {
  const root = blenderScene();
  const plan = planLandmark(toSceneNodes(root), root.userData, 'agora');
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.colliders.map((c) => c.shape), ['box', 'cylinder', 'trimesh']);
  assert.deepEqual(plan.sensors.map((s) => s.id), ['tribune']);
  assert.deepEqual(r(plan.spawns.host!.position), [0, 0, -4]);
});
