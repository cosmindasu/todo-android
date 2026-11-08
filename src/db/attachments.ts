import type { SQLiteDatabase } from 'expo-sqlite';

export interface Attachment {
  id: number;
  todoId: number;
  /** The name the file had where it came from. DISPLAY ONLY — never a path. */
  name: string;
  size: number;
  /** The generated name inside the app's attachments directory. */
  storedAs: string;
  createdAt: number;
}

interface AttachmentRow {
  id: number;
  todo_id: number;
  name: string;
  size: number;
  stored_as: string;
  created_at: number;
}

const fromRow = (r: AttachmentRow): Attachment => ({
  id: r.id,
  todoId: r.todo_id,
  name: r.name,
  size: r.size,
  storedAs: r.stored_as,
  createdAt: r.created_at,
});

export async function listAttachments(db: SQLiteDatabase, todoId: number): Promise<Attachment[]> {
  const rows = await db.getAllAsync<AttachmentRow>(
    'SELECT * FROM attachments WHERE todo_id = ? ORDER BY created_at ASC, id ASC',
    todoId,
  );
  return rows.map(fromRow);
}

/** How many files each task has, for the list. One query, not one per row. */
export async function attachmentCounts(db: SQLiteDatabase): Promise<Map<number, number>> {
  const rows = await db.getAllAsync<{ todo_id: number; n: number }>(
    'SELECT todo_id, COUNT(*) AS n FROM attachments GROUP BY todo_id',
  );
  return new Map(rows.map((r) => [r.todo_id, r.n]));
}

export async function insertAttachment(
  db: SQLiteDatabase,
  todoId: number,
  a: { name: string; size: number; storedAs: string },
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO attachments (todo_id, name, size, stored_as, created_at) VALUES (?, ?, ?, ?, ?)',
    todoId,
    a.name,
    a.size,
    a.storedAs,
    Date.now(),
  );
  return result.lastInsertRowId;
}

/**
 * Remove one attachment row and report the file it was pointing at, so the
 * caller can delete the bytes too. Returns null if the row was already gone.
 */
export async function deleteAttachment(db: SQLiteDatabase, id: number): Promise<string | null> {
  const row = await db.getFirstAsync<{ stored_as: string }>(
    'SELECT stored_as FROM attachments WHERE id = ?',
    id,
  );
  if (!row) return null;
  await db.runAsync('DELETE FROM attachments WHERE id = ?', id);
  return row.stored_as;
}

/**
 * Remove every attachment row of a task and report the files to delete.
 *
 * The rows go first and the bytes after, on purpose. The other order can leave
 * a row pointing at a file that no longer exists — a broken attachment the UI
 * has to explain — whereas this order can at worst leave a file nothing
 * references, which costs space and nothing else.
 */
export async function takeAttachmentsOf(db: SQLiteDatabase, todoId: number): Promise<string[]> {
  const rows = await db.getAllAsync<{ stored_as: string }>(
    'SELECT stored_as FROM attachments WHERE todo_id = ?',
    todoId,
  );
  await db.runAsync('DELETE FROM attachments WHERE todo_id = ?', todoId);
  return rows.map((r) => r.stored_as);
}

/** Every stored file name the database still knows about. Used to spot strays. */
export async function allStoredNames(db: SQLiteDatabase): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ stored_as: string }>('SELECT stored_as FROM attachments');
  return new Set(rows.map((r) => r.stored_as));
}
