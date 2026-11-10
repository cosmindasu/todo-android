/**
 * The DECISION part of reconciliation, as pure functions.
 *
 * Reconciliation compares two worlds that can drift apart:
 *   - our SQLite rows ("this task wants a reminder at 14:00")
 *   - the OS alarm store ("these notification ids are scheduled")
 * Keeping the comparison pure (data in, plan out) means it can be unit-tested
 * on a laptop; only executing the plan needs a phone. No React Native imports
 * here on purpose.
 */

export interface PlanRow {
  id: number;
  remind: boolean;
  done: boolean;
  dueAt: number | null;
  notificationId: string | null;
}

export interface ReconcilePlan {
  /** Tasks whose alarm must be (re)created, or whose stale alarm must be cancelled. */
  resync: number[];
  /** Past-due rows still pointing at an alarm that no longer exists. */
  expired: { id: number; missed: boolean }[];
  /** Scheduled OS notifications that NO row owns (candidates; re-verified under a lock before cancelling). */
  orphanIds: string[];
}

export function planReconcile(input: {
  rows: PlanRow[];
  /** Ids in the OS / expo-notifications scheduled list. */
  scheduledIds: ReadonlySet<string>;
  /** Ids still sitting in the notification shade (i.e. they did fire and were delivered). */
  presentedIds: ReadonlySet<string>;
  now: number;
  /** True when the exact-alarm permission flipped since last run: rebuild every alarm. */
  forceResync: boolean;
}): ReconcilePlan {
  const { rows, scheduledIds, presentedIds, now, forceResync } = input;
  const resync: number[] = [];
  const expired: { id: number; missed: boolean }[] = [];

  for (const r of rows) {
    const active = r.remind && !r.done && r.dueAt !== null;
    const future = active && r.dueAt! > now;
    const pastDue = active && !future;

    if (future) {
      // expo's store claiming an id is "live" is NOT proof the OS alarm exists
      // (revoking "Alarms & reminders" drops the alarms but not expo's record),
      // hence the forced rebuild when the capability changed.
      const live = r.notificationId !== null && scheduledIds.has(r.notificationId);
      if (forceResync || !live) resync.push(r.id);
    } else if (pastDue) {
      if (r.notificationId !== null) {
        // Either it fired normally while the app was closed, or the device was
        // off / the alarm was dropped. We cannot tell those apart for sure.
        // If it is still in the shade it certainly fired; otherwise flag it.
        expired.push({ id: r.id, missed: !presentedIds.has(r.notificationId) });
      }
    } else if (r.notificationId !== null) {
      // Done, or reminder switched off, but an alarm id is still recorded.
      resync.push(r.id); // syncReminder will cancel it and schedule nothing
    }
  }

  const owned = new Set<string>();
  for (const r of rows) if (r.notificationId !== null) owned.add(r.notificationId);
  const orphanIds = [...scheduledIds].filter((id) => !owned.has(id));

  return { resync, expired, orphanIds };
}

/** Key under which the last-seen exact-alarm state is stored in the `meta` table. */
export const EXACT_ALARM_META_KEY = 'exact_alarms_seen';

export function encodeExactAlarms(granted: boolean): string {
  return granted ? '1' : '0';
}

/**
 * Android does not tell a closed app that "Alarms & reminders" was toggled
 * (expo-notifications has no receiver for that broadcast), and exact-vs-inexact
 * is decided at SCHEDULE time. So we remember what we saw and compare on the
 * next run. `stored === null` (first run, or upgrade) counts as changed: one
 * harmless rebuild is cheaper than trusting an unknown state.
 */
export function exactAlarmStateChanged(stored: string | null, granted: boolean): boolean {
  return stored !== encodeExactAlarms(granted);
}

/**
 * Should this reconcile rebuild EVERY alarm instead of only the ones that look
 * missing?
 *
 * The cheap path asks expo whether an id is still scheduled. That question is
 * answered from expo's OWN bookkeeping - a SharedPreferences file in the app's
 * data directory (`SharedPreferencesNotificationsStore`) - not from the OS. The
 * two can disagree, and when they do the cheap path believes the wrong one and
 * leaves a dead reminder in place while the UI's bell says it is armed.
 *
 * Two ways they come apart, both measured on a real phone:
 *
 *  - EXACT-ALARM PERMISSION TOGGLED. Android drops or keeps the alarms itself;
 *    expo's file does not change and expo has no receiver for that broadcast.
 *
 *  - A REBOOT. Android's AlarmManager forgets every alarm. expo's file does
 *    not, and the thing that normally re-arms them is its BOOT_COMPLETED
 *    receiver - which MIUI refuses to deliver unless the user has granted the
 *    app "Autostart" (`BroadcastQueueInjector: process is not permitted to auto
 *    start`). So the file still lists the notification, `scheduledIds` contains
 *    it, `live` comes out true, and nothing is re-armed. The reminder is
 *    silently dead. That is what a reboot test found: the task was still in the
 *    future when the app was reopened, and the reminder never fired.
 *
 * `processStart` covers the reboot completely, because a device cannot reboot
 * while the JS process is alive - a reboot ALWAYS implies the next reconcile is
 * the first of a new process. It also covers a force-stop or a low-memory kill,
 * where the same divergence is possible for the same reason.
 *
 * The cost is rebuilding a handful of alarms once per app start, which is
 * nothing. The alternative is trusting a file the OS never reads.
 */
export function shouldForceResync(input: {
  /** First reconcile since this JS process started. */
  processStart: boolean;
  storedExact: string | null;
  exactAlarms: boolean;
}): boolean {
  return input.processStart || exactAlarmStateChanged(input.storedExact, input.exactAlarms);
}
