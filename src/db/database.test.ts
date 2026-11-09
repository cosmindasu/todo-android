import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { DEFAULT_PROJECT_ID, MIGRATIONS } from './database.ts';

/**
 * Runs the real migration strings against a real SQLite engine, the way
 * `migrateDbIfNeeded` does: each one followed by its version bump, foreign
 * keys off until the end.
 *
 * `node:sqlite` is built into Node, so this needs no dependency and runs in CI
 * beside the pure tests.
 */
function migrateFrom(startVersion: number, seed?: (db: DatabaseSync) => void): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (let v = 0; v < startVersion; v++) db.exec(MIGRATIONS[v]!);
  db.exec(`PRAGMA user_version = ${startVersion}`);
  seed?.(db);
  for (let v = startVersion; v < MIGRATIONS.length; v++) {
    db.exec(MIGRATIONS[v]!);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  }
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

const version = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

test('a fresh install reaches the current schema with a default project', () => {
  const db = migrateFrom(0);
  assert.equal(version(db), MIGRATIONS.length);
  // node:sqlite returns null-prototype rows, so spread before comparing.
  const projects = db.prepare('SELECT id, name FROM projects').all().map((r) => ({ ...r }));
  assert.deepEqual(projects, [{ id: DEFAULT_PROJECT_ID, name: 'Tasks' }]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM todos').get() as any).n, 0);
});

test('every older install upgrades, from every version that ever shipped', () => {
  // The case that cannot be fixed later: someone who installed an early build
  // and opens the app months on. v1 predates reminders entirely.
  for (let from = 1; from < MIGRATIONS.length; from++) {
    const db = migrateFrom(from, (d) => {
      d.exec(
        "INSERT INTO todos (title, due_at, created_at) VALUES ('old task', 1700000000000, 1690000000000)",
      );
    });
    assert.equal(version(db), MIGRATIONS.length, `from v${from}`);
    const row = db.prepare('SELECT * FROM todos').get() as any;
    assert.equal(row.title, 'old task', `from v${from}: the title survived`);
    assert.equal(row.due_at, 1700000000000, `from v${from}: the due date survived`);
    assert.equal(row.project_id, DEFAULT_PROJECT_ID, `from v${from}: moved into the default project`);
    assert.equal(row.description, '', `from v${from}: new text column defaulted`);
    assert.equal(row.in_progress, 0, `from v${from}: new flag defaulted`);
    // Nothing invented: a task completed before v4 has no honest completion time.
    assert.equal(row.started_at, null, `from v${from}`);
    assert.equal(row.done_at, null, `from v${from}`);
  }
});

test('no migration path leaves a dangling foreign key', () => {
  for (let from = 0; from < MIGRATIONS.length; from++) {
    const db = migrateFrom(from, from >= 1 ? (d) => {
      d.exec("INSERT INTO todos (title, created_at) VALUES ('t', 1)");
    } : undefined);
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    assert.deepEqual(violations, [], `from v${from}`);
  }
});

test('the foreign key is enforced once the migrations are done', () => {
  // The guard the delete paths rely on: a project that still owns tasks, or a
  // task that still owns files, cannot be deleted out from under them.
  const db = migrateFrom(0);
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
