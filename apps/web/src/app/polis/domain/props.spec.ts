import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPropName, propProblems, publishedProps } from './props.ts';

test('publishedProps keeps only known, unique prop names', () => {
  assert.deepEqual(publishedProps({ props: ['temple', 'serpent', 'temple', 'dragon', 3] }), ['temple', 'serpent']);
  assert.deepEqual(publishedProps({ props: 'temple' }), []);
  assert.deepEqual(publishedProps(null), []);
  assert.ok(isPropName('black_hole'));
  assert.ok(!isPropName('toString')); // nada heredado de Object cuenta como pieza
});

test('propProblems accepts a well-formed prop and rejects the rest', () => {
  assert.deepEqual(propProblems({ apeiron: { prop: 'temple', version: 1 } }, 'temple'), []);
  assert.equal(propProblems({}, 'temple').length, 1);
  assert.match(propProblems({ apeiron: { prop: 'serpent', version: 1 } }, 'temple')[0]!, /serpent/);
  assert.match(propProblems({ apeiron: { prop: 'temple', version: 2 } }, 'temple')[0]!, /versión/);
});
