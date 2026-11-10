/**
 * Which notifications ALREADY IN THE SHADE belong to a given task.
 *
 * Cancelling and dismissing are two different operations on Android, served by
 * two different parts of expo-notifications:
 *
 *   cancelScheduledNotificationAsync -> ExpoSchedulingDelegate -> alarmManager.cancel()
 *   dismissNotificationAsync         -> ExpoPresentationDelegate -> notificationManager.cancel()
 *
 * The first un-arms a FUTURE alarm. It does nothing whatsoever to a notification
 * that has already fired. The app used to call only the first one, so a reminder
 * that had already been delivered survived every later edit of its task, and the
 * shade accumulated one stale "Task due" per fire.
 *
 * MEASURED on a real phone (Redmi, MIUI, 2026-11-10): one task, `{"todoId":1}`,
 * two notifications in the shade with different ids, armed for 12:18 and 12:20
 * and each posted at its own minute. MIUI suppresses the heads-up banner, so the
 * first fire was invisible; re-arming the reminder two minutes later left the
 * first entry behind. The user's "I only set one reminder" and the two banners
 * were both true at once.
 *
 * WHY MATCH ON `data.todoId` AND NOT ON THE STORED ID. The obvious fix is to
 * dismiss `todos.notification_id`, but by the time we want to dismiss it that
 * column is often already null: `syncReminder` clears it when it re-arms, and
 * `reconcileReminders` clears it for a past-due row (see `planReconcile`'s
 * `expired`). The id we would need is exactly the one we threw away. The task id
 * travels inside the notification's own payload and survives all of that, so we
 * ask the OS what it is still showing and match on that instead. It also handles
 * more than one leftover at a time, which the single column cannot represent.
 */

/** The shape of `Notifications.getPresentedNotificationsAsync()` we depend on. */
export interface PresentedLike {
  request: {
    identifier: string;
    content: { data?: Record<string, unknown> | null };
  };
}

export function deliveredIdsOf(todoId: number, presented: readonly PresentedLike[]): string[] {
  const out: string[] = [];
  for (const p of presented) {
    // The payload round-trips through Android, which is free to hand a number
    // back as a string. `Number()` normalises both; NaN never equals todoId.
    const owner = Number(p.request?.content?.data?.todoId);
    if (Number.isInteger(owner) && owner === todoId) out.push(p.request.identifier);
  }
  return out;
}
