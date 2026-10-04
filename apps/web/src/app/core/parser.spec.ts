import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrame } from './parser.ts';

test('parseFrame parses valid SSE event frame', () => {
  const raw = 'event: trace\ndata: {"messages": ["step1"]}\n';
  const ev = parseFrame(raw);
  assert.notEqual(ev, null);
  assert.equal(ev?.type, 'trace');
  assert.deepEqual(ev?.data, { messages: ['step1'] });
});

test('parseFrame tolerates CRLF line endings', () => {
  const raw = 'event: turn\r\ndata: {"agent": "anaximandro", "text": "hola"}\r\n';
  const ev = parseFrame(raw);
  assert.notEqual(ev, null);
  assert.equal(ev?.type, 'turn');
  assert.equal(ev?.data.agent, 'anaximandro');
});

test('parseFrame returns null for empty or invalid frame', () => {
  assert.equal(parseFrame(''), null);
  assert.equal(parseFrame('comment only\n'), null);
});
