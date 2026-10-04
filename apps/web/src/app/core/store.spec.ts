import test from 'node:test';
import assert from 'node:assert/strict';

type Status = 'idle' | 'running' | 'done' | 'error';

class SimpleStateStore {
  status: Status = 'idle';
  trace: string[] = [];
  turns: any[] = [];
  answer = '';
  error: string | null = null;

  handleEvent(ev: { type: string; data: any }): void {
    if (ev.type === 'trace') this.trace.push(...ev.data.messages);
    else if (ev.type === 'turn') this.turns.push(ev.data);
    else if (ev.type === 'answer') { this.answer = ev.data.answer; this.status = 'done'; }
    else if (ev.type === 'error') { this.error = ev.data.message; this.status = 'error'; }
  }

  clear(): void {
    this.status = 'idle';
    this.trace = [];
    this.turns = [];
    this.answer = '';
    this.error = null;
  }
}

test('AgentStateStore processes SSE events in order', () => {
  const store = new SimpleStateStore();
  store.status = 'running';
  store.handleEvent({ type: 'trace', data: { messages: ['[Ápeiron Routing]'] } });
  store.handleEvent({ type: 'turn', data: { agent: 'anaximandro', round: 0, text: 'respuesta' } });
  store.handleEvent({ type: 'answer', data: { answer: 'Síntesis final' } });

  assert.equal(store.status, 'done');
  assert.deepEqual(store.trace, ['[Ápeiron Routing]']);
  assert.equal(store.turns.length, 1);
  assert.equal(store.answer, 'Síntesis final');
});

test('AgentStateStore handles error events correctly', () => {
  const store = new SimpleStateStore();
  store.status = 'running';
  store.handleEvent({ type: 'error', data: { message: 'rate_limit' } });

  assert.equal(store.status, 'error');
  assert.equal(store.error, 'rate_limit');
});

test('AgentStateStore clear resets state to idle', () => {
  const store = new SimpleStateStore();
  store.handleEvent({ type: 'answer', data: { answer: 'x' } });
  store.clear();

  assert.equal(store.status, 'idle');
  assert.equal(store.answer, '');
});
