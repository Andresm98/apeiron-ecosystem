import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenExpiry } from './access-token.ts';

test('tokenExpiry reads exp from a JWT payload', () => {
  const payload = btoa(JSON.stringify({ sub: 'ana', exp: 1900000000 })).replace(/=+$/, '');
  assert.equal(tokenExpiry(`h.${payload}.s`), 1900000000);
  assert.equal(tokenExpiry('no-es-un-jwt'), null);
});
