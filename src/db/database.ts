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
/**
 * Exported so the migration chain can be executed against a real SQLite engine
 * in `database.test.ts`. This is the only code in the app that touches a user's
 * existing data irreversibly, and it used to be the only code with no test at
 * all — a mistake in here cannot be fixed by shipping an update.
 */
export const MIGRATIONS: readonly string[] = [
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

  // v4: a task is not just "done or not". Work on it STARTS before it ends,
  // and most tasks carry a note that does not belong in the one-line title.
  //  - description: TEXT NOT NULL DEFAULT '' so every existing row is valid
  //    immediately; SQLite will not let ADD COLUMN be NOT NULL without a
  //    constant default.
  //  - started_at / done_at are nullable ON PURPOSE. Rows that were completed
  //    before this version exist, and there is no honest value to backfill:
  //    nobody recorded when they were finished. A migration must not invent
  //    data, so the UI has to cope with "done, time unknown".
  `ALTER TABLE todos ADD COLUMN description TEXT    NOT NULL DEFAULT '';
   ALTER TABLE todos ADD COLUMN in_progress INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE todos ADD COLUMN started_at  INTEGER;
   ALTER TABLE todos ADD COLUMN done_at     INTEGER;`,

  // v5: projects. Every task belongs to exactly one.
  //
  // The order of these four statements is forced by SQLite, and the reasons are
  // worth knowing:
  //  - The default project must EXIST before the column that defaults to it,
  //    or the first foreign-key check would fail against an empty table.
  //  - `created_at` cannot come from JavaScript: a migration is a fixed string
  //    and `execAsync` binds no parameters. SQLite computes it itself.
  //  - ADD COLUMN may be NOT NULL only with a CONSTANT default, which is why
  //    the default project has the hard-coded id 1 rather than a generated one.
  //
  // An earlier version of this comment also claimed that ADD COLUMN with
  // REFERENCES is only legal while foreign-key enforcement is OFF, and that
  // the PRAGMA below therefore had to run after the migrations. MEASURED, THAT
  // IS NOT TRUE: on SQLite 3.51.2 the whole chain runs identically with
  // enforcement on or off, with no violations either way (database.test.ts
  // asserts it). The pragma still runs afterwards, because a future migration
  // that adds a column and then backfills it would be checked mid-flight
  // otherwise — but that is prudence, not a requirement, and the test will say
  // so if a later SQLite starts refusing it.
  `CREATE TABLE projects (
     id         INTEGER PRIMARY KEY NOT NULL,
     name       TEXT    NOT NULL,
     created_at INTEGER NOT NULL
   );
   INSERT INTO projects (id, name, created_at)
     VALUES (1, 'Tasks', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
   ALTER TABLE todos ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1
     REFERENCES projects (id);
   CREATE INDEX idx_todos_project ON todos (project_id, done, due_at);`,

  // v6: up to three files per task.
  //
  // Only the METADATA lives here. The bytes are copied into the app's own
  // storage (see `src/files/attachmentStore.ts`) rather than referenced by the
  // content:// URI the picker hands over: that URI is a grant, and the grant
  // dies when the app restarts, when the user clears the other app's data, or
  // when the file is moved. A todo list that forgets its attachments overnight
  // is worse than one that never had them.
  //
  // `stored_as` is a name this app generates. The picked file's own name is
  // kept only in `name`, for display, and is never used as a path component —
  // it is untrusted text that can contain '/' and '..'.
  //
  // The foreign key is the same guard as on projects: deleting a task that
  // still has attachment rows fails loudly rather than orphaning files that
  // nothing would ever clean up.
  `CREATE TABLE attachments (
     id         INTEGER PRIMARY KEY NOT NULL,
     todo_id    INTEGER NOT NULL REFERENCES todos (id),
     name       TEXT    NOT NULL,
     size       INTEGER NOT NULL,
     stored_as  TEXT    NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX idx_attachments_todo ON attachments (todo_id);`,
];

/**
 * The project every pre-v5 task was moved into. It can be renamed, and it can
 * also be deleted once a second project exists — only the LAST project is
 * protected (`confirmDeleteProject`). `chooseActiveProject` falls through to
 * whatever remains, which `activeProject.test.ts` covers.
 */
export const DEFAULT_PROJECT_ID = 1;

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

  // After the migrations rather than before: see the note on v5 — prudence
  // for a future backfilling migration, not the hard requirement that comment
  // used to claim. SQLite defaults
  // foreign keys to OFF and the setting is per CONNECTION, not stored in the
  // file, so it has to be set on every start. With it on, deleting a project
  // that still owns tasks fails loudly instead of leaving orphan rows whose
  // reminders nothing would ever cancel.
  await db.execAsync('PRAGMA foreign_keys = ON;');
}
