import type { SQLiteDatabase } from 'expo-sqlite';

import type { TaskProgress } from './taskState';

export interface Todo extends TaskProgress {
  id: number;
  projectId: number;
  title: string;
  /** Free text beside the one-line title. Empty string, never null. */
  description: string;
  /** Epoch ms (UTC) or null. */
  dueAt: number | null;
  remind: boolean;
  /** Id returned by expo-notifications when the reminder was scheduled. */
  notificationId: string | null;
  /** True when the reminder time passed without a live OS alarm (device off, alarm dropped...). */
  reminderMissed: boolean;
  createdAt: number;
}

/** Raw row shape as SQLite returns it (snake_case, 0/1 instead of booleans). */
interface TodoRow {
  id: number;
  project_id: number;
  title: string;
  description: string;
  done: number;
  in_progress: number;
  started_at: number | null;
  done_at: number | null;
  due_at: number | null;
  remind: number;
  notification_id: string | null;
  reminder_missed: number;
  created_at: number;
}

function fromRow(r: TodoRow): Todo {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    description: r.description,
    done: r.done === 1,
    inProgress: r.in_progress === 1,
    startedAt: r.started_at,
    doneAt: r.done_at,
    dueAt: r.due_at,
    remind: r.remind === 1,
    notificationId: r.notification_id,
    reminderMissed: r.reminder_missed === 1,
    createdAt: r.created_at,
  };
}

export interface TodoInput {
  title: string;
  description: string;
  dueAt: number | null;
  remind: boolean;
}

// Open tasks first, and what is being worked on right now above the rest of
// them; among equals, soonest due date first, undated last. Completed tasks
// sink to the bottom, most recently created first.
const ORDER = `ORDER BY done ASC,
  in_progress DESC,
  CASE WHEN due_at IS NULL THEN 1 ELSE 0 END ASC,
  due_at ASC,
  created_at DESC`;

/**
 * EVERY task, across all projects. This is what the reminder code reconciles
 * against: an OS alarm belongs to a task, not to whichever project happens to
 * be on screen, so filtering here would strand alarms in hidden projects.
 */
export async function listTodos(db: SQLiteDatabase): Promise<Todo[]> {
  const rows = await db.getAllAsync<TodoRow>(`SELECT * FROM todos ${ORDER}`);
  return rows.map(fromRow);
}

/** What the screen shows: one project's tasks. */
export async function listTodosInProject(db: SQLiteDatabase, projectId: number): Promise<Todo[]> {
  const rows = await db.getAllAsync<TodoRow>(
    `SELECT * FROM todos WHERE project_id = ? ${ORDER}`,
    projectId,
  );
  return rows.map(fromRow);
}

export async function getTodo(db: SQLiteDatabase, id: number): Promise<Todo | null> {
  const row = await db.getFirstAsync<TodoRow>('SELECT * FROM todos WHERE id = ?', id);
  return row ? fromRow(row) : null;
}

export async function insertTodo(
  db: SQLiteDatabase,
  projectId: number,
  input: TodoInput,
): Promise<number> {
  // Always use bound parameters (?), never string-concatenate user text into SQL.
  const result = await db.runAsync(
    `INSERT INTO todos (project_id, title, description, due_at, remind, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    projectId,
    input.title,
    input.description,
    input.dueAt,
    input.remind ? 1 : 0,
    Date.now(),
  );
  return result.lastInsertRowId;
}

export async function updateTodo(db: SQLiteDatabase, id: number, input: TodoInput): Promise<void> {
  await db.runAsync(
    // Editing the task starts a fresh reminder story, so the "missed" flag resets.
    `UPDATE todos SET title = ?, description = ?, due_at = ?, remind = ?, reminder_missed = 0
     WHERE id = ?`,
    input.title,
    input.description,
    input.dueAt,
    input.remind ? 1 : 0,
    id,
  );
}

/**
 * Write a whole progress state at once. The three columns move together (see
 * taskState.ts), so writing them one at a time would let a reader observe a
 * task that is both done and in progress.
 */
export async function setProgress(
  db: SQLiteDatabase,
  id: number,
  p: TaskProgress,
): Promise<void> {
  await db.runAsync(
    'UPDATE todos SET done = ?, in_progress = ?, started_at = ?, done_at = ? WHERE id = ?',
    p.done ? 1 : 0,
    p.inProgress ? 1 : 0,
    p.startedAt,
    p.doneAt,
    id,
  );
}

export async function setNotificationId(
  db: SQLiteDatabase,
  id: number,
  notificationId: string | null,
): Promise<void> {
  await db.runAsync('UPDATE todos SET notification_id = ? WHERE id = ?', notificationId, id);
}

export async function deleteTodo(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM todos WHERE id = ?', id);
}

export async function setReminderMissed(db: SQLiteDatabase, id: number, missed: boolean): Promise<void> {
  await db.runAsync('UPDATE todos SET reminder_missed = ? WHERE id = ?', missed ? 1 : 0, id);
}

/** Small persistent key/value store (table `meta`). */
export async function getMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row ? row.value : null;
}

export async function setMeta(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

/** Which row (if any) currently owns this OS notification id? Used to spot orphan alarms. */
export async function findTodoIdByNotificationId(
  db: SQLiteDatabase,
  notificationId: string,
): Promise<number | null> {
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM todos WHERE notification_id = ?',
    notificationId,
  );
  return row ? row.id : null;
}
