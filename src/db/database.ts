import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'todos.db';

/**
 * Schema migrations, applied in order. SQLite keeps a free integer in the file
 * header (`PRAGMA user_version`) which we use as the schema version, so no
 * separate "migrations" table is needed.
 *
 * RULES (these are what makes it a "real" migration path):
 *  - NEVER edit a migration that has shipped. Real users' databases are already
 *    at that version and will not re-run it. Append a new entry instead.
 *  - Each migration runs inside a transaction together with the version bump,
 *    so a crash halfway leaves the DB at the old version, not in limbo.
 *  - Old data must survive: new columns need defaults (SQLite ALTER TABLE can
 *    only ADD COLUMN, it cannot change/drop most things cheaply).
 */
const MIGRATIONS: readonly string[] = [
  // v1: the original table.
  `CREATE TABLE todos (
     id         INTEGER PRIMARY KEY NOT NULL,
     title      TEXT    NOT NULL,
     done       INTEGER NOT NULL DEFAULT 0,   -- SQLite has no BOOLEAN: 0 / 1
     due_at     INTEGER,                      -- epoch milliseconds (UTC), NULL = no due date
     created_at INTEGER NOT NULL
   );
   CREATE INDEX idx_todos_done_due ON todos (done, due_at);`,

  // v2: reminders were added after v1 "shipped". Existing rows get remind = 0.
  // notification_id remembers which scheduled OS notification belongs to the
  // row, so we can cancel it when the task is edited, completed or deleted.
  `ALTER TABLE todos ADD COLUMN remind INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE todos ADD COLUMN notification_id TEXT;`,

  // v3: two things the reminder code needs to remember ACROSS app runs.
  //  - meta: a tiny key/value table. Used to remember the exact-alarm
  //    permission state we saw last time (Android never tells a closed app that
  //    it changed, so the only way to notice is to compare with what we stored).
  //  - reminder_missed: set when a reminder's time passed and the OS alarm is
  //    gone, so the UI can say so instead of silently showing nothing.
  `CREATE TABLE meta (
     key   TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );
   ALTER TABLE todos ADD COLUMN reminder_missed INTEGER NOT NULL DEFAULT 0;`,
];

/** Passed to <SQLiteProvider onInit>. Runs once per app start, before any screen renders. If it throws, DatabaseErrorBoundary (App.tsx) shows the message. */
export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  // WAL = readers don't block the writer. Persisted in the file; safe to repeat.
  await db.execAsync('PRAGMA journal_mode = WAL;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  if (current > MIGRATIONS.length) {
    // The DB was written by a NEWER build than this one (e.g. you installed an
    // older APK over a newer one). Refuse rather than silently corrupt it.
    throw new Error(
      `Database schema v${current} is newer than this app (v${MIGRATIONS.length}). Update the app.`,
    );
  }

  for (let version = current; version < MIGRATIONS.length; version++) {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(MIGRATIONS[version]);
      // PRAGMA does not accept bound parameters, hence the template string.
      // `version + 1` is a number we control, not user input.
      await txn.execAsync(`PRAGMA user_version = ${version + 1};`);
    });
  }
}
