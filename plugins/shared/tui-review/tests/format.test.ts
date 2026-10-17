// The cache format is written in Rust and read here: these hold the two to the same layout, on real `tui-review gen` output.

import { expect, test } from 'claude-code/testing';

import { Highlights, Kind, Lines, Manifest, fromBase64, spanCol, spanLen } from '../hooks/chunks';
import * as fixture from './fixture.gen';

const manifest = () => new Manifest(fromBase64(fixture.manifest));

test('the manifest reads tui-review gen output', async () => {
  const m = manifest();
  expect(m.totalLines).toBeGreaterThanOrEqual(100_000);
  expect(m.chunkLines).toBe(1024);
  expect(m.baseName).toBe('main');
  expect(m.headName).toBe('demo');
  expect(m.firstLine(0)).toBe(0);
  const last = m.file(m.files - 1);
  expect(last.firstLine + last.lineCount).toBe(m.totalLines);
  for (const index of [0, 5, m.files - 1]) {
    expect(m.fileAt(m.firstLine(index))).toBe(index);
    expect(m.fileAt(m.firstLine(index) + 1)).toBe(index);
  }
  expect(m.file(3).blob).toMatch(/^[0-9a-f]{40}$/);
});

test('lines and highlights line up', async () => {
  const m = manifest();
  fixture.lines.forEach((base64, c) => {
    const lines = new Lines(fromBase64(base64));
    const hl = new Highlights(fromBase64(fixture.hl[c]!));
    expect(lines.n).toBe(m.chunkLines);
    expect(hl.start.length).toBe(lines.n + 1);
    for (let i = 0; i < lines.n; i++) {
      expect(lines.kind[i]!).toBeLessThanOrEqual(Kind.Note);
      const width = lines.start[i + 1]! - lines.start[i]!;
      for (let s = hl.start[i]!; s < hl.start[i + 1]!; s++) {
        expect(spanCol(hl.spans[s]!) + spanLen(hl.spans[s]!)).toBeLessThanOrEqual(width);
      }
    }
  });
  const first = new Lines(fromBase64(fixture.lines[0]!));
  expect(first.kind[0]).toBe(Kind.File);
  expect(first.line(0)).toBe(m.file(0).path);
});
