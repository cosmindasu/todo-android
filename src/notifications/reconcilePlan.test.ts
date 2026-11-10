import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  encodeExactAlarms,
  exactAlarmStateChanged,
  planReconcile,
  shouldForceResync,
  type PlanRow,
} from './reconcilePlan.ts';

const NOW = 1_000_000;
const row = (over: Partial<PlanRow> & { id: number }): PlanRow => ({
  remind: true,
  done: false,
  dueAt: NOW + 60_000,
  notificationId: null,
  ...over,
});
const plan = (rows: PlanRow[], o: { scheduled?: string[]; presented?: string[]; force?: boolean } = {}) =>
  planReconcile({
    rows,
    scheduledIds: new Set(o.scheduled ?? []),
    presentedIds: new Set(o.presented ?? []),
    now: NOW,
    forceResync: o.force ?? false,
  });

test('healthy row with a live alarm needs nothing', () => {
  const p = plan([row({ id: 1, notificationId: 'n1' })], { scheduled: ['n1'] });
  assert.deepEqual(p, { resync: [], expired: [], orphanIds: [] });
});

test('future reminder with no alarm (permission granted later) is re-armed', () => {
  assert.deepEqual(plan([row({ id: 1 })]).resync, [1]);
});

test('exact-alarm change forces a rebuild even though expo still lists the id', () => {
  const rows = [row({ id: 1, notificationId: 'n1' })];
  assert.deepEqual(plan(rows, { scheduled: ['n1'] }).resync, []); // fails to detect without force
  assert.deepEqual(plan(rows, { scheduled: ['n1'], force: true }).resync, [1]);
});

test('scheduled notifications that no row owns are orphans', () => {
  const p = plan([row({ id: 1, notificationId: 'n1' })], { scheduled: ['n1', 'ghost'] });
  assert.deepEqual(p.orphanIds, ['ghost']);
});

test('past-due row with a dead id is flagged missed; one still in the shade is not', () => {
  const rows = [
    row({ id: 1, dueAt: NOW - 1, notificationId: 'gone' }),
    row({ id: 2, dueAt: NOW - 1, notificationId: 'shown' }),
  ];
  const p = plan(rows, { presented: ['shown'] });
  assert.deepEqual(p.expired, [
    { id: 1, missed: true },
    { id: 2, missed: false },
  ]);
  assert.deepEqual(p.resync, []); // never fabricate a late notification
});

test('done or reminder-off rows that still hold an alarm id get cleaned up', () => {
  const p = plan([row({ id: 1, done: true, notificationId: 'n1' }), row({ id: 2, remind: false, notificationId: 'n2' })], {
    scheduled: ['n1', 'n2'],
  });
  assert.deepEqual(p.resync, [1, 2]);
});

test('exactAlarmStateChanged', () => {
  assert.equal(exactAlarmStateChanged(null, true), true);
  assert.equal(exactAlarmStateChanged(null, false), true);
  assert.equal(exactAlarmStateChanged('1', true), false);
  assert.equal(exactAlarmStateChanged('1', false), true);
  assert.equal(exactAlarmStateChanged('0', true), true);
});

test('a process start rebuilds every alarm, whatever expo claims is scheduled', () => {
  // The case a reboot produces on MIUI: expo's SharedPreferences file survived
  // and still lists the notification, so the cheap check would call it live and
  // leave a dead reminder behind. The exact-alarm state is unchanged here, so
  // without the process-start rule nothing would be rebuilt.
  assert.equal(
    shouldForceResync({
      processStart: true,
      storedExact: encodeExactAlarms(true),
      exactAlarms: true,
    }),
    true,
  );
});

test('a later reconcile in the same process stays on the cheap path', () => {
  assert.equal(
    shouldForceResync({
      processStart: false,
      storedExact: encodeExactAlarms(true),
      exactAlarms: true,
    }),
    false,
  );
});

test('the exact-alarm rule still forces a rebuild later in the same process', () => {
  // Both reasons are independent: one covers a reboot, the other a permission
  // flipped while the app was running.
  assert.equal(
    shouldForceResync({
      processStart: false,
      storedExact: encodeExactAlarms(false),
      exactAlarms: true,
    }),
    true,
  );
  assert.equal(
    shouldForceResync({ processStart: false, storedExact: null, exactAlarms: false }),
    true,
  );
});

test('a forced resync re-arms a future row expo still calls scheduled', () => {
  // End to end through the planner: the row has an id, that id IS in
  // scheduledIds (expo's stale file), and it must be rebuilt anyway.
  const rows: PlanRow[] = [
    { id: 1, remind: true, done: false, dueAt: 2_000, notificationId: 'n1' },
  ];
  const cheap = planReconcile({
    rows,
    scheduledIds: new Set(['n1']),
    presentedIds: new Set(),
    now: 1_000,
    forceResync: false,
  });
  assert.deepEqual(cheap.resync, [], 'cheap path trusts expo and does nothing');

  const forced = planReconcile({
    rows,
    scheduledIds: new Set(['n1']),
    presentedIds: new Set(),
    now: 1_000,
    forceResync: true,
  });
  assert.deepEqual(forced.resync, [1], 'a process start rebuilds it');
});
