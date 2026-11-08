import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyTaskAction,
  nextAction,
  taskStateLabel,
  type TaskAction,
  type TaskProgress,
} from './taskState.ts';

const fresh: TaskProgress = { done: false, inProgress: false, startedAt: null, doneAt: null };
const T1 = 1_000;
const T2 = 2_000;
const T3 = 3_000;

test('a new task starts, and remembers when', () => {
  const s = applyTaskAction(fresh, 'start', T1);
  assert.deepEqual(s, { done: false, inProgress: true, startedAt: T1, doneAt: null });
});

test('pausing keeps the original start time, and so does resuming', () => {
  let s = applyTaskAction(fresh, 'start', T1);
  s = applyTaskAction(s, 'pause', T2);
  assert.equal(s.inProgress, false);
  assert.equal(s.startedAt, T1, 'pausing must not clear when the work began');
  s = applyTaskAction(s, 'start', T3);
  assert.equal(s.startedAt, T1, 'resuming must not move the start later');
  assert.equal(s.inProgress, true);
});

test('completing records the time and ends the in-progress state', () => {
  let s = applyTaskAction(fresh, 'start', T1);
  s = applyTaskAction(s, 'complete', T2);
  assert.deepEqual(s, { done: true, inProgress: false, startedAt: T1, doneAt: T2 });
});

test('a task completed without ever being started invents no start time', () => {
  const s = applyTaskAction(fresh, 'complete', T2);
  assert.equal(s.startedAt, null);
  assert.equal(s.doneAt, T2);
});

test('reopening clears the completion time but keeps the history of starting', () => {
  let s = applyTaskAction(applyTaskAction(fresh, 'start', T1), 'complete', T2);
  s = applyTaskAction(s, 'reopen', T3);
  assert.deepEqual(s, { done: false, inProgress: false, startedAt: T1, doneAt: null });
});

test('starting a completed task reopens it', () => {
  const done = applyTaskAction(fresh, 'complete', T1);
  const s = applyTaskAction(done, 'start', T2);
  assert.equal(s.done, false);
  assert.equal(s.doneAt, null);
  assert.equal(s.inProgress, true);
});

test('the invariants hold for every action from every reachable state', () => {
  const actions: TaskAction[] = ['start', 'pause', 'complete', 'reopen'];
  // Walk every sequence of four actions and check the state after each step.
  const walk = (s: TaskProgress, depth: number, now: number) => {
    if (depth === 0) return;
    for (const a of actions) {
      const next = applyTaskAction(s, a, now);
      assert.ok(!(next.done && next.inProgress), `done and inProgress together after ${a}`);
      if (!next.done) assert.equal(next.doneAt, null, `doneAt survived ${a} on an open task`);
      if (s.startedAt !== null) {
        assert.equal(next.startedAt, s.startedAt, `${a} moved an existing startedAt`);
      }
      walk(next, depth - 1, now + 1);
    }
  };
  walk(fresh, 4, T1);
});

test('the label and the next action agree with the state', () => {
  assert.equal(taskStateLabel({ done: false, inProgress: false }), 'Not started');
  assert.equal(taskStateLabel({ done: false, inProgress: true }), 'In progress');
  assert.equal(taskStateLabel({ done: true, inProgress: false }), 'Done');

  assert.equal(nextAction({ done: false, inProgress: false }), 'start');
  assert.equal(nextAction({ done: false, inProgress: true }), 'complete');
  assert.equal(nextAction({ done: true, inProgress: false }), 'reopen');
});
