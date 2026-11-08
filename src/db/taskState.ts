/**
 * The three states a task moves through, as pure data.
 *
 * The app used to have two (done / not done), which is not how the work
 * actually goes: something is picked up before it is finished, and knowing
 * WHEN it was picked up is most of the value of a task list.
 *
 * Kept out of the database layer and out of the components so the rules can be
 * tested without SQLite or React — the same split as `reconcilePlan.ts`.
 *
 * Invariants, all asserted in the tests:
 *  - `done` and `inProgress` are never both true;
 *  - a task that is not done has no `doneAt`;
 *  - `startedAt` records the FIRST time work began and is never moved later by
 *    pausing and resuming, so "started three days ago" stays true;
 *  - a task completed without ever being started keeps `startedAt === null`
 *    rather than inventing one.
 */
export type TaskAction = 'start' | 'pause' | 'complete' | 'reopen';

export interface TaskProgress {
  done: boolean;
  inProgress: boolean;
  /** Epoch ms when work first began, or null. */
  startedAt: number | null;
  /** Epoch ms when it was completed, or null. Null is also possible for rows
   *  completed before this column existed: the migration had nothing honest to
   *  put there. Callers must handle "done, time unknown". */
  doneAt: number | null;
}

export function applyTaskAction(s: TaskProgress, action: TaskAction, now: number): TaskProgress {
  switch (action) {
    case 'start':
      // Starting a completed task reopens it; that is what a user means by it.
      return { done: false, inProgress: true, startedAt: s.startedAt ?? now, doneAt: null };
    case 'pause':
      // `startedAt` survives: it is when the work began, not a stopwatch.
      return { ...s, inProgress: false };
    case 'complete':
      return { done: true, inProgress: false, startedAt: s.startedAt, doneAt: now };
    case 'reopen':
      return { done: false, inProgress: false, startedAt: s.startedAt, doneAt: null };
  }
}

export type TaskStateLabel = 'Not started' | 'In progress' | 'Done';

export function taskStateLabel(s: Pick<TaskProgress, 'done' | 'inProgress'>): TaskStateLabel {
  if (s.done) return 'Done';
  return s.inProgress ? 'In progress' : 'Not started';
}

/** What tapping the primary control should do next, given where the task is. */
export function nextAction(s: Pick<TaskProgress, 'done' | 'inProgress'>): TaskAction {
  if (s.done) return 'reopen';
  return s.inProgress ? 'complete' : 'start';
}
