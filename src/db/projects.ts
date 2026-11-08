import type { SQLiteDatabase } from 'expo-sqlite';

import { chooseActiveProject } from './activeProject';
import { DEFAULT_PROJECT_ID } from './database';
import { getMeta, setMeta } from './todos';

export interface Project {
  id: number;
  name: string;
  createdAt: number;
}

interface ProjectRow {
  id: number;
  name: string;
  created_at: number;
}

const fromRow = (r: ProjectRow): Project => ({ id: r.id, name: r.name, createdAt: r.created_at });

export async function listProjects(db: SQLiteDatabase): Promise<Project[]> {
  const rows = await db.getAllAsync<ProjectRow>('SELECT * FROM projects ORDER BY created_at ASC, id ASC');
  return rows.map(fromRow);
}

export async function insertProject(db: SQLiteDatabase, name: string): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO projects (name, created_at) VALUES (?, ?)',
    name,
    Date.now(),
  );
  return result.lastInsertRowId;
}

export async function renameProject(db: SQLiteDatabase, id: number, name: string): Promise<void> {
  await db.runAsync('UPDATE projects SET name = ? WHERE id = ?', name, id);
}

/**
 * Removes the project row only. The caller MUST have deleted its tasks first,
 * each through `deleteTaskAndReminder` so the OS alarms go with them — a task
 * deleted straight from SQLite would leave an alarm nothing can ever cancel.
 *
 * With `PRAGMA foreign_keys = ON` (set in database.ts) this throws rather than
 * orphaning rows if the caller forgets, which is the point of the constraint.
 */
export async function deleteProject(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM projects WHERE id = ?', id);
}

export async function listTodoIdsInProject(db: SQLiteDatabase, projectId: number): Promise<number[]> {
  const rows = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM todos WHERE project_id = ?',
    projectId,
  );
  return rows.map((r) => r.id);
}

export const ACTIVE_PROJECT_KEY = 'active_project';

export async function getActiveProjectId(db: SQLiteDatabase): Promise<number | null> {
  const [stored, projects] = await Promise.all([getMeta(db, ACTIVE_PROJECT_KEY), listProjects(db)]);
  return chooseActiveProject(stored, projects.map((p) => p.id), DEFAULT_PROJECT_ID);
}

export async function setActiveProjectId(db: SQLiteDatabase, id: number): Promise<void> {
  await setMeta(db, ACTIVE_PROJECT_KEY, String(id));
}
