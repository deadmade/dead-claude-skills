import { expect, test } from 'claude-code/testing';

import { findPaths, fromHref, linkify, resolvePath, toHref } from './paths';

const one = (text: string) => {
  const found = findPaths(text);
  expect(found.length).toBe(1);
  return found[0]!;
};

test('findPaths finds bare, code and link paths', () => {
  expect(one('see docs/a.md.').raw).toBe('docs/a.md');
  const code = one('open `docs/a.md` now');
  expect(code.kind).toBe('code');
  expect(code.raw).toBe('docs/a.md');
  expect(code.label).toBe('`docs/a.md`');
  const link = one('the [spec](docs/s.md#goals) says');
  expect(link).toEqual({ start: 4, end: 27, raw: 'docs/s.md', label: 'spec', kind: 'link' });
  expect(one('at docs/a.md:12:3').raw).toBe('docs/a.md');
  expect(one('(docs/a.md)').raw).toBe('docs/a.md');
  expect(one('plan ~/.claude/plans/p.md').raw).toBe('~/.claude/plans/p.md');
  expect(one('C:\\proj\\a.md').raw).toBe('C:\\proj\\a.md');
  expect(one('C:/proj/a.md').raw).toBe('C:/proj/a.md');
  expect(one('[s](file:///C:/proj/s.md)').raw).toBe('C:/proj/s.md');
  expect(one('file:///proj/a.md').raw).toBe('/proj/a.md');
  expect(one('`docs/my notes ü.md`').raw).toBe('docs/my notes ü.md');
});

test('findPaths covers the whole match', () => {
  const text = 'a `docs/a.md` b';
  const f = one(text);
  expect(text.slice(f.start, f.end)).toBe('`docs/a.md`');
  const bare = 'x docs/a.md:4, y';
  const g = one(bare);
  expect(bare.slice(g.start, g.end)).toBe('docs/a.md:4');
});

test('findPaths finds nothing in look-alikes', () => {
  for (const text of [
    'https://github.com/x/README.md',
    '[r](https://x.io/r.md)',
    '[see docs/a.md](https://x.io)',
    'run `glow docs/a.md` there',
    'version 1.2.3',
    'a/b',
    'notes.txt',
    'before\n```\ndocs/a.md\n```\nafter',
    '~~~md\ndocs/a.md\n~~~',
  ]) {
    expect(findPaths(text)).toEqual([]);
  }
});

test('findPaths keeps going after a fence', () => {
  expect(one('```\nx.md\n```\nthen y.md').raw).toBe('y.md');
});

test('resolvePath makes absolute slash paths', () => {
  expect(resolvePath('docs/a.md', '/proj', null)).toBe('/proj/docs/a.md');
  expect(resolvePath('../b.md', '/proj/docs', null)).toBe('/proj/b.md');
  expect(resolvePath('./a/../c.md', '/proj', null)).toBe('/proj/c.md');
  expect(resolvePath('~/x.md', '/proj', '/home/u')).toBe('/home/u/x.md');
  expect(resolvePath('/abs/x.md', '/proj', null)).toBe('/abs/x.md');
  expect(resolvePath('docs\\a.md', 'C:\\proj', null)).toBe('C:/proj/docs/a.md');
  expect(resolvePath('~/x.md', 'C:\\proj', 'C:\\Users\\u')).toBe('C:/Users/u/x.md');
  expect(resolvePath('C:\\other\\x.md', '/proj', null)).toBe('C:/other/x.md');
});

test('hrefs encode and decode paths', () => {
  expect(toHref('/proj/my notes ü.md')).toBe('file:///proj/my%20notes%20%C3%BC.md');
  expect(toHref('C:/proj/a.md')).toBe('file:///C:/proj/a.md');
  for (const p of ['/proj/docs/a.md', '/proj/b.md', '/home/u/x.md', 'C:/proj/docs/a.md', '/proj/my notes ü.md']) {
    expect(fromHref(toHref(p))).toBe(p);
  }
  expect(fromHref('file:///proj/a b.md')).toBe('/proj/a b.md');
});

test('linkify rewrites only the matches', () => {
  const text = 'read docs/a.md now';
  const links = findPaths(text).map((f) => ({ ...f, href: 'file:///proj/docs/a.md' }));
  expect(linkify(text, links)).toBe('read [docs/a.md](file:///proj/docs/a.md) now');
  const code = 'see `docs/a.md`.';
  expect(
    linkify(
      code,
      findPaths(code).map((f) => ({ ...f, href: 'file:///a' })),
    ),
  ).toBe('see [`docs/a.md`](file:///a).');
  const link = 'the [spec](docs/s.md) x';
  expect(
    linkify(
      link,
      findPaths(link).map((f) => ({ ...f, href: 'file:///s' })),
    ),
  ).toBe('the [spec](file:///s) x');
  expect(linkify(text, [])).toBe(text);
});

test('findPaths skips fences nested in list items', () => {
  expect(findPaths('1. Run:\n\n     ```bash\n     grep x docs/a.md\n     ```\n')).toEqual([]);
});

test('a longer fence is closed only by a fence as long', () => {
  expect(findPaths('````md\n```\ndocs/a.md\n```\n````\nthen y.md').map((f) => f.raw)).toEqual(['y.md']);
});
