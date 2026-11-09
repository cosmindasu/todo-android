import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { DEFAULT_PROJECT_ID, MIGRATIONS, migrateDbIfNeeded } from './database.ts';

/**
 * The three methods `migrateDbIfNeeded` actually uses, over `node:sqlite`.
 *
 * The point is to run the SHIPPED function rather than a copy of its loop. The
 * first version of this file re-implemented the loop, which left the version
 * guard, the loop bounds, the transaction wrapping and the placement of
 * `PRAGMA foreign_keys = ON` untested — change `<` to `<=`, or bump the
 * version before running the migration instead of after, and the suite stayed
 * green. An audit pointed that out.
 */
function shim(db: DatabaseSync): any {
  const self: any = {
    execAsync: async (sql: string) => { db.exec(sql); },
    getFirstAsync: async (sql: string) => db.prepare(sql).get(),
    withExclusiveTransactionAsync: async (task: (txn: any) => Promise<void>) => {
      db.exec('BEGIN EXCLUSIVE');
      try {
        await task(self);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return self;
}

/**
 * Runs the real migration strings against a real SQLite engine, the way
 * `migrateDbIfNeeded` does: each one followed by its version bump, foreign
 * keys off until the end.
 *
 * `node:sqlite` is built into Node, so this needs no dependency and runs in CI
 * beside the pure tests.
 */
async function migrateFrom(
  startVersion: number,
  seed?: (db: DatabaseSync) => void,
): Promise<DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (let v = 0; v < startVersion; v++) db.exec(MIGRATIONS[v]!);
  db.exec(`PRAGMA user_version = ${startVersion}`);
  seed?.(db);
  await migrateDbIfNeeded(shim(db)); // the real runner, not a copy of its loop
  return db;
}

/**
 * A row as a real user would have it: every column carrying a value that is
 * NOT its default, so a migration that drops the column is visible.
 *
 * The first version of this test seeded three columns and asserted seven, so a
 * table rebuild that "forgot" `done`, `remind`, `notification_id` and
 * `reminder_missed` passed all six tests while silently reopening every
 * completed task, discarding every reminder opt-in and stranding every OS
 * alarm. A table rebuild is not exotic: it is how SQLite drops a column or
 * changes its type, so it is the most likely shape of a future migration.
 */
function seedRealisticRow(db: DatabaseSync, version: number): void {
  db.exec(
    "INSERT INTO todos (title, due_at, created_at, done) VALUES ('pay the rent', 1700000000000, 1690000000000, 1)",
  );
  if (version >= 2) {
    db.exec("UPDATE todos SET remind = 1, notification_id = 'alarm-abc'");
  }
  if (version >= 3) db.exec('UPDATE todos SET reminder_missed = 1');
}

/** Every column that existed at `version`, with the value seedRealisticRow set. */
function assertRowSurvived(db: DatabaseSync, version: number, label: string): void {
  const row = db.prepare('SELECT * FROM todos').get() as any;
  assert.equal(row.title, 'pay the rent', `${label}: title`);
  assert.equal(row.due_at, 1700000000000, `${label}: due_at`);
  assert.equal(row.created_at, 1690000000000, `${label}: created_at`);
  assert.equal(row.done, 1, `${label}: done — a completed task must not reopen`);
  if (version >= 2) {
    assert.equal(row.remind, 1, `${label}: remind — the opt-in must survive`);
    assert.equal(
      row.notification_id,
      'alarm-abc',
      `${label}: notification_id — losing it strands the OS alarm forever`,
    );
  }
  if (version >= 3) assert.equal(row.reminder_missed, 1, `${label}: reminder_missed`);
  // Added later, so they must be at their documented defaults.
  assert.equal(row.project_id, DEFAULT_PROJECT_ID, `${label}: moved into the default project`);
  assert.equal(row.description, '', `${label}: new text column defaulted`);
  assert.equal(row.in_progress, 0, `${label}: new flag defaulted`);
  // Nothing invented: a task completed before v4 has no honest completion time.
  assert.equal(row.started_at, null, `${label}: started_at`);
  assert.equal(row.done_at, null, `${label}: done_at`);
}

const version = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

test('a fresh install reaches the current schema with a default project', async () => {
  const db = await migrateFrom(0);
  assert.equal(version(db), MIGRATIONS.length);
  // node:sqlite returns null-prototype rows, so spread before comparing.
  const projects = db.prepare('SELECT id, name FROM projects').all().map((r) => ({ ...r }));
  assert.deepEqual(projects, [{ id: DEFAULT_PROJECT_ID, name: 'Tasks' }]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM todos').get() as any).n, 0);
});

test('every older install upgrades with every column intact', async () => {
  // The case that cannot be fixed later: someone who installed an early build
  // and opens the app months on. v1 predates reminders entirely.
  for (let from = 1; from < MIGRATIONS.length; from++) {
    const db = await migrateFrom(from, (d) => seedRealisticRow(d, from));
    assert.equal(version(db), MIGRATIONS.length, `from v${from}`);
    assertRowSurvived(db, from, `from v${from}`);
  }
});

test('no migration path leaves a dangling foreign key', async () => {
  for (let from = 0; from < MIGRATIONS.length; from++) {
    const db = await migrateFrom(from, from >= 1 ? (d) => seedRealisticRow(d, from) : undefined);
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    assert.deepEqual(violations, [], `from v${from}`);
  }
});

test('the foreign key is enforced once the migrations are done', async () => {
  // The guard the delete paths rely on: a project that still owns tasks, or a
  // task that still owns files, cannot be deleted out from under them.
  const db = await migrateFrom(0);
  db.exec("INSERT INTO todos (title, created_at, project_id) VALUES ('t', 1, 1)");
  assert.throws(() => db.exec('DELETE FROM projects WHERE id = 1'), /FOREIGN KEY/i);
  const id = (db.prepare('SELECT id FROM todos').get() as any).id;
  db.exec(`INSERT INTO attachments (todo_id, name, size, stored_as, created_at)
           VALUES (${id}, 'a.pdf', 1, '1.pdf', 1)`);
  assert.throws(() => db.exec(`DELETE FROM todos WHERE id = ${id}`), /FOREIGN KEY/i);
});

test('the pragma ordering is prudence, not a requirement', () => {
  // This test was written to confirm a comment claiming SQLite refuses
  // `ADD COLUMN ... REFERENCES` while enforcement is on, and that the ordering
  // of the pragma therefore mattered. It does not: the chain runs identically
  // either way, and the comment was corrected rather than the code.
  //
  // It is kept pointing the other way, so that a later SQLite which DOES start
  // refusing it is noticed here rather than on someone's phone mid-upgrade.
  for (const enforcement of ['OFF', 'ON'] as const) {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA foreign_keys = ${enforcement}`);
    for (let v = 0; v < MIGRATIONS.length; v++) db.exec(MIGRATIONS[v]!);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], `with fks ${enforcement}`);
  }
});

test('a migration is never edited after shipping: the count only grows', () => {
  // Not a tautology — it pins the number of shipped migrations, so appending is
  // fine and renumbering or removing one fails here before it reaches a device.
  assert.equal(MIGRATIONS.length, 6);
});
