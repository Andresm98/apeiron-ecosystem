import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSupabaseError } from './supabase-auth-errors.ts';

test('describeSupabaseError maps Supabase Auth codes to actionable messages', () => {
  assert.match(describeSupabaseError('invalid_credentials', 400, 'login'), /incorrectos/);
  assert.match(describeSupabaseError('email_not_confirmed', 400, 'login'), /Confirma tu correo/);
  assert.match(describeSupabaseError('user_already_exists', 422, 'register'), /Ya existe/);
  assert.match(describeSupabaseError(undefined, 429, 'login'), /Espera un minuto/);
  assert.match(describeSupabaseError(undefined, undefined, 'login'), /conexión con Supabase/);
});
