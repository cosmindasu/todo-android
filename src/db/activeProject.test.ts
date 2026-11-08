import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chooseActiveProject } from './activeProject.ts';

const DEFAULT = 1;

test('keeps the stored project when it still exists', () => {
  assert.equal(chooseActiveProject('7', [1, 7, 9], DEFAULT), 7);
});

test('falls back to the default project when the stored one was deleted', () => {
  assert.equal(chooseActiveProject('7', [1, 9], DEFAULT), 1);
});

test('falls back to the first remaining project when even the default is gone', () => {
  assert.equal(chooseActiveProject('7', [5, 9], DEFAULT), 5);
});

test('survives a missing or unusable stored value', () => {
  for (const bad of [null, '', 'tasks', '1.5', 'NaN', '1e400']) {
    assert.equal(chooseActiveProject(bad, [1, 2], DEFAULT), 1, `stored ${JSON.stringify(bad)}`);
  }
});

test('returns null rather than inventing a project when there are none', () => {
  assert.equal(chooseActiveProject('1', [], DEFAULT), null);
  assert.equal(chooseActiveProject(null, [], DEFAULT), null);
});
