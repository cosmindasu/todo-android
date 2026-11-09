import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  acceptAttachments,
  firstFreeName,
  formatSize,
  storedFileName,
  tooLargeMessage,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
} from './attachmentLimit.ts';

test('everything fits while there is room', () => {
  assert.deepEqual(acceptAttachments(0, 3), { accepted: 3, refused: 0, message: null });
  assert.deepEqual(acceptAttachments(2, 1), { accepted: 1, refused: 0, message: null });
  assert.deepEqual(acceptAttachments(0, 0), { accepted: 0, refused: 0, message: null });
});

test('a partial batch says how many were left out', () => {
  const d = acceptAttachments(1, 5);
  assert.equal(d.accepted, 2);
  assert.equal(d.refused, 3);
  assert.match(d.message ?? '', /Only 2 files could be added/);
  assert.match(d.message ?? '', /3 were left out/);
});

test('a full task refuses everything and says what to do about it', () => {
  const d = acceptAttachments(MAX_ATTACHMENTS, 2);
  assert.equal(d.accepted, 0);
  assert.match(d.message ?? '', /Remove one first/);
});

test('singular and plural are not mangled', () => {
  assert.match(acceptAttachments(2, 2).message ?? '', /Only 1 file could be added/);
  assert.match(acceptAttachments(2, 2).message ?? '', /1 was left out/);
  assert.match(acceptAttachments(3, 1).message ?? '', /already has 3 files/);
  assert.match(acceptAttachments(1, 3, 1).message ?? '', /already has 1 file,/);
});

test('nonsense counts cannot produce a negative or oversized allowance', () => {
  for (const existing of [-5, 0, 1, 3, 99]) {
    for (const picked of [-2, 0, 1, 50]) {
      const d = acceptAttachments(existing, picked);
      assert.ok(d.accepted >= 0, `accepted ${d.accepted}`);
      assert.ok(d.refused >= 0, `refused ${d.refused}`);
      assert.ok(d.accepted <= MAX_ATTACHMENTS, 'never allows more than the limit');
      assert.ok(d.accepted <= Math.max(0, picked), 'never allows more than were picked');
    }
  }
});

test('a stored name is never a path, whatever the file was called', () => {
  const nasty = [
    '../../../etc/passwd',
    '/etc/shadow',
    'a/../../b.sh',
    'note.txt/../../evil',
    'C:\\Windows\\system32\\cmd.exe',
    'file\u0000.png',
    '.hidden',
    '..',
    '.',
    '',
    'x'.repeat(500) + '.' + 'y'.repeat(500),
    'photo.PNG',
    'archive.tar.gz',
    'résumé.pdf',
  ];
  for (const name of nasty) {
    const stored = storedFileName(7, name);
    assert.ok(!stored.includes('/'), `slash in ${JSON.stringify(stored)}`);
    assert.ok(!stored.includes('\\'), `backslash in ${JSON.stringify(stored)}`);
    assert.ok(!stored.includes('\u0000'), 'NUL survived');
    assert.ok(!stored.includes('..'), `traversal in ${JSON.stringify(stored)}`);
    assert.ok(/^7(\.[a-z0-9]{1,10})?$/.test(stored), `unexpected shape ${JSON.stringify(stored)}`);
  }
});

test('the extension is kept when it is a real one', () => {
  assert.equal(storedFileName(1, 'invoice.pdf'), '1.pdf');
  assert.equal(storedFileName(2, 'photo.PNG'), '2.png');
  assert.equal(storedFileName(3, 'archive.tar.gz'), '3.gz');
  assert.equal(storedFileName(4, 'noextension'), '4');
  // A leading dot is not an extension: ".hidden" has no name before the dot.
  assert.equal(storedFileName(5, '.hidden'), '5');
});

test('a nonsense sequence number still produces a usable name', () => {
  for (const seq of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(storedFileName(seq, 'a.txt'), '0.txt');
  }
});

test('sizes read the way a person would say them', () => {
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(1024), '1.0 KB');
  assert.equal(formatSize(1536), '1.5 KB');
  assert.equal(formatSize(1024 * 1024), '1.0 MB');
  assert.equal(formatSize(15 * 1024 * 1024), '15 MB');
  assert.equal(formatSize(-1), 'unknown size');
  assert.equal(formatSize(Number.NaN), 'unknown size');
});

test('a file over the ceiling is refused with its own size in the message', () => {
  assert.equal(tooLargeMessage('a.pdf', 1024), null);
  assert.equal(tooLargeMessage('a.pdf', MAX_ATTACHMENT_BYTES), null, 'the limit itself is allowed');
  // Clearly over: the file's own size is worth stating.
  const big = tooLargeMessage('big.mov', 300 * 1024 * 1024) ?? '';
  assert.match(big, /big\.mov/);
  assert.match(big, /is 300 MB/);
  assert.match(big, /stops at 25 MB/);

  // One byte over: both numbers would render "25 MB", so the size is dropped
  // rather than printed as "is 25 MB ... stops at 25 MB".
  const edge = tooLargeMessage('edge.mov', MAX_ATTACHMENT_BYTES + 1) ?? '';
  assert.match(edge, /just over the limit/);
  assert.doesNotMatch(edge, /is 25 MB/);
});

test('an unknown size is not treated as too large', () => {
  // The picker does not always report a size; refusing on that would block
  // perfectly ordinary files.
  assert.equal(tooLargeMessage('a.pdf', null), null);
  assert.equal(tooLargeMessage('a.pdf', Number.NaN), null);
});

test('a name already in the store is never handed out again', () => {
  // The defect this closes: names came from Date.now() and were trusted to be
  // unique. Two saves a few milliseconds apart produced the same name, the
  // write overwrote, and one task's bytes replaced another's — after which
  // deleting either task left the other pointing at nothing.
  const taken = new Set(['100.pdf', '101.pdf', '102.pdf']);
  assert.equal(firstFreeName(100, 'a.pdf', (n) => taken.has(n)), '103.pdf');
  assert.equal(firstFreeName(100, 'a.png', (n) => taken.has(n)), '100.png', 'a different extension does not collide');
  assert.equal(firstFreeName(104, 'a.pdf', (n) => taken.has(n)), '104.pdf', 'past the run, the first try wins');
});

test('it gives up rather than looping forever when everything is taken', () => {
  assert.throws(() => firstFreeName(0, 'a.pdf', () => true, 50), /free name/);
});

test('the name it hands out is still a safe one', () => {
  // Whatever the loop does, the result must still satisfy storedFileName's
  // contract: no path component can come from the user's filename.
  const taken = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const n = firstFreeName(7, '../../etc/passwd.sh', (x) => taken.has(x));
    assert.match(n, /^\d+(\.[a-z0-9]{1,10})?$/, n);
    taken.add(n);
  }
  assert.equal(taken.size, 5, 'five distinct names');
});
