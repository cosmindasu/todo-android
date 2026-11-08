/**
 * Which project the screen should show.
 *
 * Deliberately free of imports so `node --test` can load it: the pure rules
 * live apart from the SQLite layer, the same way `reconcilePlan.ts` is kept
 * apart from `reminders.ts`. Node's ESM loader does not resolve the
 * extensionless imports that Metro and TypeScript accept, so a pure module
 * that reaches into the database layer is a module that cannot be tested.
 *
 * The awkward cases are the point: the stored project may have been deleted on
 * another run, the stored value may be missing or not a number, and a database
 * with no projects at all must not take the screen down with it.
 */
export function chooseActiveProject(
  stored: string | null,
  existing: readonly number[],
  fallbackId: number,
): number | null {
  const wanted = stored === null ? Number.NaN : Number(stored);
  if (Number.isInteger(wanted) && existing.includes(wanted)) return wanted;
  if (existing.includes(fallbackId)) return fallbackId;
  return existing[0] ?? null;
}
