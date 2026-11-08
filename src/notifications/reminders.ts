/**
 * Everything about Android local notifications lives in this one file, because
 * this is the part of the app that is genuinely different from the web.
 *
 * Three independent gates decide whether a reminder shows up on time:
 *
 *   1. Notification CHANNEL   (Android 8+ / API 26)
 *   2. POST_NOTIFICATIONS     (runtime permission, Android 13+ / API 33)
 *   3. SCHEDULE_EXACT_ALARM   (special access, Android 12+ / API 31)
 *
 * Each can be missing independently, and each fails differently. Read on.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  deleteTodo,
  findTodoIdByNotificationId,
  getMeta,
  getTodo,
  listTodos,
  setMeta,
  setNotificationId,
  setReminderMissed,
} from '../db/todos';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createKeyedMutex } from './keyedMutex';
import {
  EXACT_ALARM_META_KEY,
  encodeExactAlarms,
  exactAlarmStateChanged,
  planReconcile,
} from './reconcilePlan';

/**
 * (1) CHANNEL. Since Android 8 every notification must belong to a channel, and
 * the USER (not the app) controls each channel's sound/importance in system
 * settings. Without a channel the notification is silently dropped. Also: on
 * Android 13+ the system permission prompt will not appear until at least one
 * channel exists, so this MUST run before requestPermissionsAsync().
 * Importance is fixed at creation; changing it later in code does nothing
 * (the user's choice wins). To change it you must use a new channel id.
 */
export const REMINDER_CHANNEL_ID = 'reminders';

export async function ensureReminderChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Task reminders',
    description: 'Reminders for tasks that have a due date',
    importance: Notifications.AndroidImportance.HIGH, // HIGH = heads-up banner + sound
  });
}

/** Call once at startup: how a notification is shown if it fires while the app is open. */
export function configureForegroundBehaviour(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export type NotificationAccess = 'granted' | 'undetermined' | 'denied-can-ask' | 'denied-blocked';

export interface ReminderCapabilities {
  /** (2) POST_NOTIFICATIONS state, including whether Android will still show the dialog. */
  notifications: NotificationAccess;
  /** (3) Exact alarms allowed? false => reminders can fire minutes late (or not on time at all in Doze). */
  exactAlarms: boolean;
}

export async function getCapabilities(): Promise<ReminderCapabilities> {
  const [n, a] = await Promise.all([
    Notifications.getPermissionsAsync(),
    Notifications.getExactAlarmPermissionsAsync(),
  ]);
  let notifications: NotificationAccess;
  if (n.granted) notifications = 'granted';
  else if (n.status === Notifications.PermissionStatus.UNDETERMINED) notifications = 'undetermined';
  // Android only shows the system dialog twice. After a second denial
  // canAskAgain is false and the ONLY route is the app's system settings page.
  else notifications = n.canAskAgain ? 'denied-can-ask' : 'denied-blocked';
  return { notifications, exactAlarms: a.granted };
}

/**
 * (2) POST_NOTIFICATIONS. Android 13+ treats notifications as opt-in. Until the
 * user taps Allow, scheduling "succeeds" but nothing is ever displayed - the
 * worst kind of failure, because there is no error. That is why we check the
 * permission explicitly instead of trusting scheduleNotificationAsync.
 *
 * Returns true only if notifications are now allowed.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  await ensureReminderChannel(); // see (1): the dialog needs a channel to exist
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain && current.status === Notifications.PermissionStatus.DENIED) {
    return false; // dialog would not appear; caller should offer "Open settings"
  }
  const result = await Notifications.requestPermissionsAsync();
  return result.granted;
}

/**
 * (3) EXACT ALARMS. Android schedules notifications through AlarmManager. Plain
 * alarms are "inexact": the OS batches them to save battery, and in Doze mode
 * they can be late by many minutes. For a reminder due at 14:00 that is a bug.
 * Exact alarms need SCHEDULE_EXACT_ALARM, declared in app.json. From Android
 * 14 it is DENIED BY DEFAULT for new installs and is not a dialog: the user
 * must flip a switch on a system settings screen ("Alarms & reminders").
 * (USE_EXACT_ALARM is auto-granted but Google Play restricts it to alarm-clock
 * and calendar apps; a todo list does not qualify, so we do not declare it.)
 *
 * This opens that settings screen and resolves when the user comes back.
 * Caveat from the docs: if the user REVOKES it there, Android kills and
 * restarts the app, and this promise never resolves.
 */
export async function requestExactAlarmAccess(): Promise<boolean> {
  const result = await Notifications.requestExactAlarmPermissionsAsync();
  return result.granted;
}

export type ScheduleOutcome =
  | { scheduled: true; notificationId: string; exact: boolean }
  | { scheduled: false; reason: 'no-reminder' | 'in-the-past' | 'no-permission' };

/**
 * CONCURRENCY. Every read -> cancel -> schedule -> write sequence below touches
 * two stores (SQLite and the OS) with `await`s in between, so it is NOT atomic.
 * Two overlapping calls for the same task would both read "no alarm yet", both
 * schedule, and the second write would orphan the first alarm forever. This
 * mutex queues all work per task id (see keyedMutex.ts for the full story).
 * Anything that changes a task's alarm MUST go through it.
 */
const withTaskLock = createKeyedMutex();
const lockKey = (todoId: number) => `todo:${todoId}`;

/**
 * Schedule (or re-schedule) the reminder for one todo, and persist the
 * resulting notification id. Safe to call repeatedly: it cancels the previous
 * notification first, so editing a task never leaves a ghost reminder behind.
 *
 * Takes an ID, not a Todo object, on purpose: a Todo held by a component can be
 * stale (the DB may have changed since it was rendered), so the truth is
 * re-read from SQLite inside the lock.
 */
export function syncReminder(db: SQLiteDatabase, todoId: number): Promise<ScheduleOutcome> {
  return withTaskLock(lockKey(todoId), () => syncReminderLocked(db, todoId));
}

async function syncReminderLocked(db: SQLiteDatabase, todoId: number): Promise<ScheduleOutcome> {
  const todo = await getTodo(db, todoId);
  if (!todo) return { scheduled: false, reason: 'no-reminder' }; // deleted meanwhile

  await cancelLocked(db, todoId);

  if (!todo.remind || todo.done || todo.dueAt === null) {
    return { scheduled: false, reason: 'no-reminder' };
  }
  if (todo.dueAt <= Date.now()) {
    return { scheduled: false, reason: 'in-the-past' };
  }

  await ensureReminderChannel();
  const caps = await getCapabilities();
  if (caps.notifications !== 'granted') {
    return { scheduled: false, reason: 'no-permission' };
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Task due',
      body: todo.title,
      data: { todoId: todo.id },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(todo.dueAt),
      channelId: REMINDER_CHANNEL_ID,
      // 'bestEffort' uses setExactAndAllowWhileIdle() when the exact-alarm
      // permission is granted, and silently degrades to inexact when it is not.
      // ('alarmClock' would also show an alarm icon in the status bar - wrong
      // for a todo reminder.)
      // NOTE: the choice is made NOW and baked into the alarm. Granting the
      // permission later does not upgrade it; reconcileReminders() rebuilds
      // alarms when it notices the permission changed.
      delivery: 'bestEffort',
    },
  });
  // A crash right here (alarm scheduled, id not yet saved) leaves an orphan.
  // We cannot make two stores atomic, so reconcileReminders() sweeps orphans:
  // it cancels any scheduled notification that no row owns.
  await setNotificationId(db, todo.id, notificationId);
  return { scheduled: true, notificationId, exact: caps.exactAlarms };
}

/**
 * Cancel the OS alarm of a task. Takes the task ID and looks up the
 * notification id in the DATABASE: callers' Todo objects may be stale (e.g.
 * the list was loaded before reconcile wrote fresh ids), and trusting a stale
 * `notificationId === null` meant "cancel nothing" while the alarm lived on.
 */
export function cancelReminder(db: SQLiteDatabase, todoId: number): Promise<void> {
  return withTaskLock(lockKey(todoId), () => cancelLocked(db, todoId));
}

/** Only call while already holding the task's lock (the mutex is not re-entrant). */
async function cancelLocked(db: SQLiteDatabase, todoId: number): Promise<void> {
  const fresh = await getTodo(db, todoId);
  if (fresh?.notificationId) {
    await Notifications.cancelScheduledNotificationAsync(fresh.notificationId);
    await setNotificationId(db, todoId, null);
  }
}

/**
 * Delete a task and its alarm as ONE locked step. If a sync for the same task
 * were still in flight, it could otherwise schedule a new alarm after we cancel
 * but before the row disappears.
 */
export function deleteTaskAndReminder(db: SQLiteDatabase, todoId: number): Promise<void> {
  return withTaskLock(lockKey(todoId), async () => {
    await cancelLocked(db, todoId); // before the row (and its notification_id) is gone
    await deleteTodo(db, todoId);
  });
}

/**
 * Bring the OS alarms back in line with the database. Run at startup, when the
 * app returns to the foreground, and when a permission changes - NOT just once,
 * because the two worlds drift while the app is closed:
 *
 *  - "Clear data" wipes alarms; a restored backup brings rows without alarms.
 *  - A reminder is saved while notifications are denied; the user allows them
 *    later (no alarm exists for that row yet).
 *  - Exact-alarm permission toggled: Android drops/keeps alarms but expo's own
 *    store still lists them, and expo has no receiver for that broadcast. So
 *    "expo says it is scheduled" proves nothing. We persist the last-seen
 *    capability and, when it differs, cancel and re-create everything.
 *  - Crash between scheduling and saving the id leaves an orphan alarm.
 *  - Device off at the due time: Android removes the past-due alarm on re-arm.
 *
 * expo-notifications re-arms alarms after a reboot itself (RECEIVE_BOOT_COMPLETED).
 * Reads its own data from SQLite (never a caller's list, which may be stale).
 * Runs one at a time: overlapping reconciles would fight over the same rows.
 */
export function reconcileReminders(db: SQLiteDatabase): Promise<void> {
  return withTaskLock('reconcile', () => reconcileLocked(db));
}

async function reconcileLocked(db: SQLiteDatabase): Promise<void> {
  const caps = await getCapabilities();
  // Without notification permission nothing can be scheduled. Return WITHOUT
  // storing the exact-alarm state, so the first run after the user allows
  // notifications still does a full rebuild.
  if (caps.notifications !== 'granted') return;

  const storedExact = await getMeta(db, EXACT_ALARM_META_KEY);
  const forceResync = exactAlarmStateChanged(storedExact, caps.exactAlarms);

  const [rows, scheduled, presented] = await Promise.all([
    listTodos(db),
    Notifications.getAllScheduledNotificationsAsync(),
    Notifications.getPresentedNotificationsAsync().catch(() => []),
  ]);

  const plan = planReconcile({
    rows,
    scheduledIds: new Set(scheduled.map((s) => s.identifier)),
    presentedIds: new Set(presented.map((p) => p.request.identifier)),
    now: Date.now(),
    forceResync,
  });

  // Reminders whose time passed while no alarm was alive. We deliberately do
  // NOT fire a late notification (it would look like it is due right now).
  // We drop the dead id and flag the row so the list can say "missed".
  for (const e of plan.expired) {
    await withTaskLock(lockKey(e.id), async () => {
      await setNotificationId(db, e.id, null);
      if (e.missed) await setReminderMissed(db, e.id, true);
    });
  }

  for (const id of plan.resync) {
    await syncReminder(db, id);
  }

  // OS -> DB direction: cancel alarms that no row owns. Ownership is re-checked
  // INSIDE the task's lock, because a sync in flight may have just scheduled
  // an alarm whose id it has not saved yet - that one is not an orphan.
  const byId = new Map(scheduled.map((s) => [s.identifier, s]));
  for (const orphanId of plan.orphanIds) {
    const todoId = Number(byId.get(orphanId)?.content.data?.todoId);
    const key = Number.isInteger(todoId) ? lockKey(todoId) : 'todo:unknown';
    await withTaskLock(key, async () => {
      if ((await findTodoIdByNotificationId(db, orphanId)) === null) {
        await Notifications.cancelScheduledNotificationAsync(orphanId);
      }
    });
  }

  // Record the state only after the rebuild succeeded, so a crash midway
  // retries it on the next run instead of believing it is done.
  await setMeta(db, EXACT_ALARM_META_KEY, encodeExactAlarms(caps.exactAlarms));
}
