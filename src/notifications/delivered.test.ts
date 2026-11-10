import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deliveredIdsOf, type PresentedLike } from './delivered.ts';

const shown = (identifier: string, data: Record<string, unknown> | null): PresentedLike => ({
  request: { identifier, content: { data } },
});

test('picks only the notifications belonging to the task', () => {
  const presented = [shown('a', { todoId: 1 }), shown('b', { todoId: 2 }), shown('c', { todoId: 1 })];
  assert.deepEqual(deliveredIdsOf(1, presented), ['a', 'c']);
  assert.deepEqual(deliveredIdsOf(2, presented), ['b']);
  assert.deepEqual(deliveredIdsOf(3, presented), []);
});

test('accepts the id as a string, because Android may hand it back as one', () => {
  assert.deepEqual(deliveredIdsOf(7, [shown('a', { todoId: '7' })]), ['a']);
});

test('ignores notifications with no usable owner instead of matching them', () => {
  // A foreign notification, a missing payload and a non-numeric id must not be
  // dismissed: this function decides what the app is allowed to remove.
  const junk = [
    shown('a', null),
    shown('b', {}),
    shown('c', { todoId: 'not a number' }),
    shown('d', { todoId: 1.5 }),
    shown('e', { other: 1 }),
  ];
  assert.deepEqual(deliveredIdsOf(1, junk), []);
  assert.deepEqual(deliveredIdsOf(0, junk), []);
});

test('returns every leftover, not just the newest', () => {
  // The whole point: the shade can hold more than one stale entry per task,
  // which a single `notification_id` column cannot represent.
  const many = [shown('x', { todoId: 4 }), shown('y', { todoId: 4 }), shown('z', { todoId: 4 })];
  assert.deepEqual(deliveredIdsOf(4, many), ['x', 'y', 'z']);
});
