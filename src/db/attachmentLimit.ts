/**
 * The rules around attaching files, kept pure so they can be tested: how many
 * of the picked files fit, and what a file is allowed to be called once it is
 * inside this app's storage.
 *
 * Import-free on purpose, like `activeProject.ts` — Node's test runner cannot
 * resolve the extensionless imports that Metro accepts.
 */
export const MAX_ATTACHMENTS = 3;

/**
 * A picked file is copied by reading it into memory and writing it out again,
 * because the picker may hand back a `content://` URI that a plain file copy
 * cannot follow. Reading into memory is only safe with a ceiling on it, so
 * there is one, and the user is told rather than left with a crash.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface AcceptDecision {
  /** How many of the picked files may be added. */
  accepted: number;
  refused: number;
  /** Null when everything fits; otherwise what to tell the user, and why. */
  message: string | null;
}

export function acceptAttachments(
  existing: number,
  picked: number,
  max: number = MAX_ATTACHMENTS,
): AcceptDecision {
  const room = Math.max(0, max - Math.max(0, existing));
  const accepted = Math.max(0, Math.min(picked, room));
  const refused = Math.max(0, picked - accepted);
  if (refused === 0) return { accepted, refused: 0, message: null };
  const one = refused === 1;
  return {
    accepted,
    refused,
    message:
      accepted === 0
        ? `This task already has ${existing} file${existing === 1 ? '' : 's'}, which is the limit of ${max}. Remove one first.`
        : `Only ${accepted} file${accepted === 1 ? '' : 's'} could be added: the limit is ${max} per task, so ${refused} ${one ? 'was' : 'were'} left out.`,
  };
}

/**
 * The name a picked file gets INSIDE this app's storage.
 *
 * The name that comes back from the system picker is untrusted text. It can
 * contain '/', '..', a NUL, or be hundreds of characters long, and joining it
 * onto a directory path would let a chosen file be written anywhere the app
 * can write. So the stored name is generated from a number we control, and the
 * only thing taken from the original is a conservative extension: letters and
 * digits, lower-cased, at most 10 of them, and only when there is something
 * before the dot.
 *
 * The original name is still shown to the user; it is just never a path.
 */
export function storedFileName(seq: number, originalName: string): string {
  const safeSeq = Number.isSafeInteger(seq) && seq >= 0 ? seq : 0;
  const base = originalName.slice(originalName.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const rawExt = dot > 0 ? base.slice(dot + 1) : '';
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  return ext.length > 0 ? `${safeSeq}.${ext}` : String(safeSeq);
}

/** Null when the file may be stored; otherwise why it may not. */
export function tooLargeMessage(
  name: string,
  size: number | null,
  max: number = MAX_ATTACHMENT_BYTES,
): string | null {
  if (size === null || !Number.isFinite(size)) return null; // unknown: let it try
  if (size <= max) return null;
  // Just over the limit, both numbers render the same ("is 25 MB ... stops at
  // 25 MB"), which reads like a contradiction. Drop the file's own size then.
  const shown = formatSize(size);
  const limit = formatSize(max);
  const how = shown === limit ? 'is just over the limit' : `is ${shown}`;
  return `"${name}" ${how}. This app copies attachments into its own storage and stops at ${limit} each.`;
}

/** Human-readable size for the list. Binary units, because that is what the OS reports. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
