import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createKeyedMutex } from './keyedMutex.ts';

const tick = () => new Promise((r) => setTimeout(r, 5));

test('jobs for the same key never overlap, and run in call order', async () => {
  const run = createKeyedMutex();
  const log: string[] = [];
  const job = (name: string) => async () => {
    log.push(`start ${name}`);
    await tick();
    log.push(`end ${name}`);
  };
  await Promise.all([run('a', job('1')), run('a', job('2')), run('a', job('3'))]);
  assert.deepEqual(log, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
});

test('different keys run concurrently', async () => {
  const run = createKeyedMutex();
  const log: string[] = [];
  const job = (name: string) => async () => {
    log.push(`start ${name}`);
    await tick();
    log.push(`end ${name}`);
  };
  await Promise.all([run('a', job('A')), run('b', job('B'))]);
  assert.deepEqual(log.slice(0, 2), ['start A', 'start B']);
});

test('a failing job rejects its caller but does not wedge the queue', async () => {
  const run = createKeyedMutex();
  const failing = run('a', async () => {
    throw new Error('boom');
  });
  const next = run('a', async () => 'ok');
  await assert.rejects(failing, /boom/);
  assert.equal(await next, 'ok');
});

test('read-modify-write is atomic per key (the duplicate-alarm scenario)', async () => {
  const run = createKeyedMutex();
  let stored: number | null = null; // stands in for notification_id
  let scheduled = 0; // stands in for OS alarms
  const sync = async () => {
    const current = stored; // (1) read
    await tick();
    if (current === null) {
      scheduled++; // (3) schedule
      await tick();
      stored = scheduled; // (4) write
    }
  };
  await Promise.all([run('t', sync), run('t', sync)]);
  assert.equal(scheduled, 1);

  // Control: WITHOUT the lock the same code double-schedules.
  stored = null;
  scheduled = 0;
  await Promise.all([sync(), sync()]);
  assert.equal(scheduled, 2);
});
