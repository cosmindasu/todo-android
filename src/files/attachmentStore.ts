/**
 * Where the attached bytes actually live.
 *
 * The picker returns a reference to someone else's file — on Android usually a
 * `content://` URI, which is a GRANT rather than a path. It expires, and the
 * file behind it can be moved or deleted by the app that owns it. A todo list
 * that showed an attachment yesterday and cannot open it today would be worse
 * than one with no attachments, so the bytes are copied into this app's own
 * document directory and the original is never referenced again.
 *
 * The copy is read-then-write rather than a filesystem copy, because a
 * filesystem copy cannot follow a content:// URI. That means the file passes
 * through memory, which is only safe with a ceiling — `MAX_ATTACHMENT_BYTES`
 * in `attachmentLimit.ts`.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { firstFreeName, formatSize, MAX_ATTACHMENT_BYTES } from '../db/attachmentLimit';

const DIR_NAME = 'attachments';

function dir(): Directory {
  const d = new Directory(Paths.document, DIR_NAME);
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

export function attachmentFile(storedAs: string): File {
  return new File(dir(), storedAs);
}

/**
 * Copy a picked file in under a name this app generated, and report how many
 * bytes were actually written.
 *
 * The caller must store THAT number, not the size the picker reported. The
 * picker's size comes from a DocumentsProvider and can be stale: measured
 * here, a file the picker called 25459 bytes was 11359 bytes when it was read
 * a few seconds later, and a row showing the picker's figure would have been
 * wrong forever.
 *
 * For the same reason the ceiling is re-checked here. The check at pick time
 * is a cheap gate on a number that may be a lie; this one is on the bytes in
 * hand, and it is the one that binds.
 */
/**
 * A name no file in the store is using yet.
 *
 * The caller used to derive names from `Date.now()` and trust them to be
 * unique. Two saves a few milliseconds apart — or a clock stepping backwards
 * onto an already-used millisecond — produced the same name, and since the
 * write overwrites, one task's bytes replaced another's: the second task then
 * opened the first one's document, and deleting either left the other with a
 * row pointing at nothing. An audit hit that collision by accident while
 * measuring something else.
 *
 * Asking the filesystem is a guarantee rather than a probability, and it costs
 * one stat. Writes here are sequential and awaited, so a name reserved on one
 * iteration exists before the next one looks.
 */
export function reserveStoredName(seq: number, originalName: string): string {
  return firstFreeName(seq, originalName, (name) => attachmentFile(name).exists);
}

export async function storeAttachment(sourceUri: string, storedAs: string): Promise<number> {
  const bytes = await new File(sourceUri).bytes();
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `That file is ${formatSize(bytes.length)}, over the ${formatSize(MAX_ATTACHMENT_BYTES)} limit for an attachment.`,
    );
  }
  const target = attachmentFile(storedAs);
  target.create({ overwrite: true, intermediates: true });
  await target.write(bytes);
  return bytes.length;
}

/** Delete stored bytes. A file that is already gone is not an error. */
export function deleteStored(storedAs: string): void {
  try {
    const f = attachmentFile(storedAs);
    if (f.exists) f.delete();
  } catch {
    // Losing a few bytes of cache is not worth failing a delete the user asked
    // for; the row is already gone either way.
  }
}

/**
 * Delete stored files that no row points at any more — the residue of a crash
 * between writing bytes and committing the row. Returns how many it removed.
 */
export function sweepStrays(known: ReadonlySet<string>): number {
  let removed = 0;
  try {
    for (const entry of dir().list()) {
      const name = entry.name;
      // `list()` returns directories too, and `deleteStored` skips anything
      // that is not a file — so counting it as removed would be a lie.
      if (!name || known.has(name) || !attachmentFile(name).exists) continue;
      deleteStored(name);
      removed++;
    }
  } catch {
    // Best effort.
  }
  return removed;
}
