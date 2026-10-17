// Finding .md paths in reply text and turning them into file: links. Pure: no `$`, so the tests need no engine.

export type Found = { start: number; end: number; raw: string; label: string; kind: 'bare' | 'code' | 'link' };

const SEG = String.raw`[\p{L}\p{N}_.@+-]`;
const SUFFIX = /(?::\d+){1,2}$/;
const TOKEN = new RegExp(
  [
    String.raw`\[([^\]\n]*)\]\(([^)\s]+)\)`,
    '`([^`\\n]+)`',
    String.raw`(?<![\p{L}\p{N}_/\\.~:%-])((?:file:///)?(?:~[/\\]|[A-Za-z]:[/\\]|/)?(?:${SEG}+[/\\])*${SEG}*[\p{L}\p{N}_]\.md)((?::\d+){0,2})(?![\p{L}\p{N}_/\\])`,
  ].join('|'),
  'gu',
);

// A scheme other than a drive letter (`C:`); `file:` targets are paths, the rest are left alone.
const scheme = (s: string) => /^[a-z][a-z0-9+.-]+:/i.exec(s)?.[0].toLowerCase();

// The path a link target or code span names, or null when it names none.
function pathOf(target: string): string | null {
  let s = target.replace(/#.*$/, '').replace(SUFFIX, '');
  const sch = scheme(s);
  if (sch === 'file:') s = fromHref(s);
  else if (sch) return null;
  return s.endsWith('.md') && s.length > 3 ? s : null;
}

// Line ranges inside ``` or ~~~ fences (indented ones too, as in list items), where nothing is linked. A fence
// closes only on a bare fence of its own character, at least as long.
function fences(text: string): [number, number][] {
  const out: [number, number][] = [];
  let open = -1;
  let mark = '';
  let at = 0;
  for (const line of text.split('\n')) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence && open < 0) {
      open = at;
      mark = fence;
    } else if (fence && fence[0] === mark[0] && fence.length >= mark.length && /^\s*[`~]+\s*$/.test(line)) {
      out.push([open, at + line.length]);
      open = -1;
    }
    at += line.length + 1;
  }
  if (open >= 0) out.push([open, text.length]);
  return out;
}

export function findPaths(text: string): Found[] {
  const fenced = fences(text);
  const out: Found[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index;
    const end = start + m[0].length;
    if (fenced.some(([a, b]) => start >= a && start < b)) continue;
    const [, label, target, code, bare] = m;
    if (target !== undefined) {
      const raw = pathOf(target);
      if (raw) out.push({ start, end, raw, label: label!, kind: 'link' });
    } else if (code !== undefined) {
      // A span with spaces is a path only when a folder comes before the first space: `glow docs/a.md` is a command.
      const space = code.search(/\s/);
      if (space >= 0 && !/[/\\]/.test(code.slice(0, space))) continue;
      const raw = pathOf(code);
      if (raw) out.push({ start, end, raw, label: m[0], kind: 'code' });
    } else if (bare !== undefined) {
      const raw = bare.startsWith('file:') ? fromHref(bare) : bare;
      out.push({ start, end, raw, label: m[0], kind: 'bare' });
    }
  }
  return out;
}

export function resolvePath(raw: string, base: string, home: string | null): string {
  const slash = (s: string) => s.replace(/\\/g, '/');
  let p = slash(raw);
  if (p.startsWith('~/') && home !== null) p = `${slash(home)}/${p.slice(2)}`;
  else if (!p.startsWith('/') && !/^[A-Za-z]:\//.test(p)) p = `${slash(base)}/${p}`;
  const drive = /^[A-Za-z]:/.exec(p)?.[0] ?? '';
  const segs: string[] = [];
  for (const seg of p.slice(drive.length).split('/')) {
    if (seg === '..') segs.pop();
    else if (seg !== '' && seg !== '.') segs.push(seg);
  }
  return `${drive}/${segs.join('/')}`;
}

// Parentheses are encoded too: a raw one would end the Markdown link's target.
const enc = (seg: string) =>
  encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function toHref(abs: string): string {
  const drive = /^[A-Za-z]:/.exec(abs)?.[0];
  const rest = drive ? abs.slice(2) : abs;
  return `file://${drive ? `/${drive}` : ''}${rest.split('/').map(enc).join('/')}`;
}

export function fromHref(href: string): string {
  let p = href.replace(/^file:\/\/(localhost)?/i, '');
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

export function linkify(text: string, links: ReadonlyArray<Found & { href: string }>): string {
  let out = '';
  let at = 0;
  for (const l of [...links].sort((a, b) => a.start - b.start)) {
    out += `${text.slice(at, l.start)}[${l.label}](${l.href})`;
    at = l.end;
  }
  return out + text.slice(at);
}
