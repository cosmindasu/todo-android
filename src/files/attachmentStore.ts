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

const DIR_NAME = 'attachments';

function dir(): Directory {
  const d = new Directory(Paths.document, DIR_NAME);
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

export function attachmentFile(storedAs: string): File {
  return new File(dir(), storedAs);
}

/** Copy a picked file in under a name this app generated. */
export async function storeAttachment(sourceUri: string, storedAs: string): Promise<void> {
  const bytes = await new File(sourceUri).bytes();
  const target = attachmentFile(storedAs);
  target.create({ overwrite: true, intermediates: true });
  await target.write(bytes);
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
      if (name && !known.has(name)) {
        deleteStored(name);
        removed++;
      }
    }
  } catch {
    // Best effort.
  }
  return removed;
}
