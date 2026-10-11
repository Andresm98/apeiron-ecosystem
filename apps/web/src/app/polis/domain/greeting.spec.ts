import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalPoint, hostSpot, layoutCity } from './city-layout.ts';
import { GREET_M, GREET_RESET_M, SAYINGS, greeting } from './greeting.ts';

test('the first greeting welcomes the player with the thinker’s own epithet', () => {
  assert.equal(greeting('ssanax', 'Nadie se baña dos veces en el mismo río', 0), 'Hola, ssanax, bienvenido. Nadie se baña dos veces en el mismo río.');
  assert.equal(greeting('ssanax', '«todo fluye»', 0), 'Hola, ssanax, bienvenido. Todo fluye.');
  assert.equal(greeting('ssanax', '¿Qué es la virtud?', 0), 'Hola, ssanax, bienvenido. ¿Qué es la virtud?');
});

test('without an epithet or a name the greeting still reads well', () => {
  assert.equal(greeting('ssanax', undefined, 0), `Hola, ssanax, bienvenido. ${SAYINGS[0]}`);
  assert.equal(greeting('  ', '', 0), `Hola, viajero, bienvenido. ${SAYINGS[0]}`);
});

test('repeat visits rotate through the sayings', () => {
  const texts = Array.from({ length: SAYINGS.length + 1 }, (_, i) => greeting('ssanax', 'x', i + 1));
  assert.equal(texts[0], `De nuevo por aquí, ssanax. ${SAYINGS[0]}`);
  assert.equal(new Set(texts.slice(0, SAYINGS.length)).size, SAYINGS.length);
  assert.equal(texts[SAYINGS.length], texts[0]);
});

test('a thinker greets whoever arrives at its island, by bridge or by map', () => {
  const places = layoutCity([{ name: 'heraclito', role: 'r', tools: [], kind: 'local' }]);
  const place = places.find((p) => p.kind === 'agent')!;
  const host = hostSpot(place);
  const arrival = arrivalPoint(place);
  assert.ok(Math.hypot(arrival.x - host.x, arrival.z - host.z) < GREET_M, 'llegada por el mapa');
  const d = Math.hypot(place.x, place.z);
  const bridgeEnd = { x: place.x * (1 - place.radius / d), z: place.z * (1 - place.radius / d) };
  assert.ok(Math.hypot(bridgeEnd.x - host.x, bridgeEnd.z - host.z) < GREET_M, 'llegada por el puente');
  assert.ok(GREET_RESET_M > GREET_M);
});
