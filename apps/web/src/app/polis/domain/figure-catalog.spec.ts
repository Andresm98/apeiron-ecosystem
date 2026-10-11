import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutCity } from './city-layout.ts';
import { citizenFigure, parseFigures, playerFigure, playerFigures } from './figure-catalog.ts';

const CATALOG = parseFigures({
  version: 2,
  characters: [
    { id: 'ssanax', kind: 'rigged', title: 'Guerrero de cristal' },
    { id: 'ssanax2', kind: 'rigged', title: 'Señor oscuro' },
    { id: 'philosopher', kind: 'statue', title: 'Estatua de mármol' },
  ],
});

test('parseFigures reads v2 entries and keeps v1 manifests working', () => {
  assert.deepEqual(CATALOG.map((f) => `${f.id}:${f.kind}`), ['ssanax:rigged', 'ssanax2:rigged', 'philosopher:statue']);
  assert.deepEqual(parseFigures({ version: 1, characters: ['ssanax', 'philosopher'] }).map((f) => f.kind), ['rigged', 'statue']);
  assert.deepEqual(parseFigures(null), []);
});

test('parseFigures drops invalid, duplicated or unknown-kind entries', () => {
  const figures = parseFigures({ characters: [
    { id: 'Darth Vader', kind: 'rigged' }, { id: 'ok', kind: 'rigged' }, { id: 'ok', kind: 'statue' }, { id: 'robot', kind: 'drone' }, 7,
  ] });
  assert.deepEqual(figures, [{ id: 'ok', kind: 'rigged', title: 'ok' }]);
});

test('the player wears a rigged figure: the chosen one, else the default, else the first', () => {
  assert.deepEqual(playerFigures(CATALOG).map((f) => f.id), ['ssanax', 'ssanax2']);
  assert.equal(playerFigure(CATALOG, 'ssanax2')?.id, 'ssanax2');
  assert.equal(playerFigure(CATALOG, 'philosopher')?.id, 'ssanax'); // una estatua no camina
  assert.equal(playerFigure(CATALOG, 'retirada')?.id, 'ssanax');
  assert.equal(playerFigure(parseFigures({ characters: [{ id: 'x', kind: 'rigged' }] }), null)?.id, 'x');
  assert.equal(playerFigure([], 'ssanax'), null);
});

test('an agent wears what its manifest declares, falling back to the marble statue or the procedural figure', () => {
  assert.equal(citizenFigure(CATALOG, 'ssanax2')?.kind, 'rigged');
  assert.equal(citizenFigure(CATALOG, 'philosopher')?.kind, 'statue');
  assert.equal(citizenFigure(CATALOG, 'inexistente')?.id, 'philosopher');
  assert.equal(citizenFigure(CATALOG)?.id, 'philosopher');
  assert.equal(citizenFigure([], 'ssanax2'), null);
});

test('the figure declared in an agent manifest reaches its place in the city', () => {
  const places = layoutCity([
    { name: 'socrates', role: 'r', tools: [], residence: { title: 'Ágora chica', subtitle: 's', landmark: 'temple', color: '#aabbcc', figure: 'ssanax2' } },
    { name: 'tales', role: 'r', tools: [] },
  ]);
  assert.equal(places.find((p) => p.id === 'socrates')?.figure, 'ssanax2');
  assert.equal(places.find((p) => p.id === 'tales')?.figure, undefined);
});
