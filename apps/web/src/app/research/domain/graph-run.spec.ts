import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNodeEvent, edgeVisited, emptyRun, isLastEdge } from './graph-run.ts';
import type { NodeEvent } from './chat.ts';

const ev = (node: string, status: 'start' | 'end', error = false): NodeEvent => ({ node, status, error });

test('applyNodeEvent records root transitions in order, ignoring inner nodes', () => {
    let run = emptyRun();
    for (const e of [
        ev('apeiron_router', 'start'), ev('apeiron_router', 'end'),
        ev('anaximandro', 'start'), ev('anaximandro/reason', 'start'), ev('anaximandro/reason', 'end'),
        ev('anaximandro/act', 'start'), ev('anaximandro/act', 'end'),
        ev('anaximandro/reason', 'start'), ev('anaximandro/reason', 'end'), ev('anaximandro', 'end'),
        ev('apeiron_supervisor', 'start'), ev('apeiron_supervisor', 'end'),
        ev('apeiron_synthesis', 'start'), ev('apeiron_synthesis', 'end'),
    ]) run = applyNodeEvent(run, e);

    assert.deepEqual(run.edges, [
        '__start__>apeiron_router', 'apeiron_router>anaximandro', 'anaximandro>apeiron_supervisor',
        'apeiron_supervisor>apeiron_synthesis', 'apeiron_synthesis>__end__',
    ]);
    assert.equal(run.visits['anaximandro/reason'], 2);
    assert.equal(run.visits['anaximandro/act'], 1);
    assert.equal(run.status['anaximandro'], 'done');
    assert.ok(edgeVisited(run, 'apeiron_router', 'anaximandro'));
    assert.ok(isLastEdge(run, 'apeiron_synthesis', '__end__'));
});

test('applyNodeEvent marks active and failed nodes', () => {
    let run = applyNodeEvent(emptyRun(), ev('heraclito', 'start'));
    assert.equal(run.status['heraclito'], 'active');
    assert.equal(run.current, 'heraclito');
    run = applyNodeEvent(run, ev('heraclito', 'end', true));
    assert.equal(run.status['heraclito'], 'error');
});
