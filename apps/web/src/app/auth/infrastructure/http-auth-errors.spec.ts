import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAuthError } from './http-auth-errors.ts';

test('describeAuthError maps API statuses to actionable messages', () => {
  assert.match(describeAuthError(401, 'login'), /incorrectos/);
  assert.match(describeAuthError(409, 'register'), /ya existe/);
  assert.match(describeAuthError(429, 'login'), /Espera un minuto/);
  assert.match(describeAuthError(0, 'login'), /conexión/);
});

test('config failures never fall back to a guessed provider', () => {
  assert.match(describeAuthError(502, 'config'), /arrancando/);
  assert.match(describeAuthError(0, 'config'), /arrancando/);
  assert.match(describeAuthError(500, 'config'), /error interno/);
});
