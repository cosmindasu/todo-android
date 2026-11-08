/**
 * A tiny "one at a time per key" lock, built from nothing but promises.
 *
 * WHY THIS EXISTS (the lesson for a web developer): JavaScript is
 * single-threaded, but that does NOT make `async` code atomic. Every `await` is
 * a point where other code may run. This sequence looks harmless:
 *
 *     const id = await readIdFromDb();      // (1)
 *     await cancel(id);                     // (2)
 *     const fresh = await schedule();       // (3)
 *     await writeIdToDb(fresh);             // (4)
 *
 * but if two callers start it for the same task, both can pass (1) seeing
 * `null`, both schedule at (3), and the second (4) overwrites the first one's
 * id: the first alarm still exists in the OS but nothing points to it any more
 * (an "orphan"). It will fire later and can never be cancelled.
 *
 * The fix is to make the whole sequence run strictly one after another for the
 * same key. No library is needed: keep, per key, the promise of the LAST job
 * queued, and chain the next job onto it.
 *
 * Keep this file free of React Native imports so it can be unit-tested with
 * plain Node (see keyedMutex.test.ts).
 */
export type KeyedMutex = <T>(key: string, job: () => Promise<T>) => Promise<T>;

export function createKeyedMutex(): KeyedMutex {
  // key -> promise that settles when the most recently queued job for it is done.
  const tails = new Map<string, Promise<void>>();

  return function runExclusive<T>(key: string, job: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();

    // Run after the previous job, whether it succeeded or threw: one failed
    // job must not wedge the queue forever.
    const result = previous.then(job);

    // The tail must never reject, or the NEXT job's `.then` would skip itself.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);

    // Housekeeping: drop the entry when nobody queued behind us, so the Map
    // does not grow by one entry per task id forever.
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });

    return result;
  };
}
