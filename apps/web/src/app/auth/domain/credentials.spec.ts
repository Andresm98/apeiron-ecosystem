import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCredentials } from './credentials.ts';

test('validateCredentials mirrors backend limits and confirms password on register', () => {
  assert.equal(validateCredentials({ username: 'ana', password: 'clave-larga' }, false), null);
  assert.match(validateCredentials({ username: 'an', password: 'clave-larga' }, false) ?? '', /usuario/);
  assert.match(validateCredentials({ username: 'ana', password: 'corta' }, false) ?? '', /contraseña/);
  assert.match(
    validateCredentials({ username: 'ana', password: 'clave-larga', confirm: 'otra-clave' }, true) ?? '',
    /no coinciden/,
  );
});
