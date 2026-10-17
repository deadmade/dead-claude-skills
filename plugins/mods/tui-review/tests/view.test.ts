import { expect, test } from 'claude-code/testing';

import { Manifest, fromBase64 } from '../hooks/chunks';
import { wrap } from '../hooks/comments';
import { View } from '../hooks/view';
import * as fixture from './fixture.gen';

const manifest = new Manifest(fromBase64(fixture.manifest));

test('rows map to lines and back with files collapsed and notes under lines', async () => {
  const collapsed = new Uint8Array(manifest.files);
  collapsed[1] = 1;
  const header1 = manifest.firstLine(1);
  const inFile2 = manifest.firstLine(2) + 3;
  const view = new View(
    manifest,
    collapsed,
    new Map([
      [5, ['a', 'b']],
      [header1, ['c']],
      [inFile2, ['d']],
    ]),
  );
  expect(view.rows).toBe(manifest.totalLines - manifest.lineCount(1) + 1 + 4);

  // Every row lands on a line, and each line's own row maps back to it.
  let notes = 0;
  for (let row = 0; row < view.rows; row++) {
    const { line, note } = view.locate(row);
    if (note > 0) notes++;
    else expect(view.rowOfLine(line)).toBe(row);
    if (row > 200 + manifest.firstLine(3)) break;
  }
  expect(notes).toBe(4);
  expect(view.locate(6)).toMatchObject({ line: 5, note: 1 });
  expect(view.locate(7)).toMatchObject({ line: 5, note: 2 });
  expect(view.locate(8)).toMatchObject({ line: 6, note: 0 });
  expect(view.locate(view.headerRow(1) + 1)).toMatchObject({ file: 1, line: header1, note: 1 });
  expect(view.headerRow(2)).toBe(view.headerRow(1) + 2);
  expect(view.rowOfLine(header1 + 4)).toBe(view.headerRow(1));
});

test('wrap breaks at spaces, and inside a word longer than the width', async () => {
  expect(wrap('one two three', 7)).toEqual(['one two', 'three']);
  expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  expect(wrap('  short  ', 20)).toEqual(['short']);
  expect(wrap('a\nb', 20)).toEqual(['a', 'b']);
});
