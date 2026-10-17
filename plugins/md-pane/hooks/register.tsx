import type { EngineInterface, Register } from 'claude-code';

import { findPaths, linkify, resolvePath, toHref } from './paths';

export const PANE = 'md-pane';
// Under the engine's 100 000 characters per drawing; past it a Markdown's pressable links are dropped.
const MAX_TEXT = 99_000;
const MAX_LINKS = 256;
const MAX_HREF = 2048;
const MISS_MS = 2000;

type Stat = { size: number; mtimeMs: number };

// Module state, reset by `register` so a reload (and each test) starts clean.
let files = new Map<string, Promise<Stat | null>>();

// Whether `path` is a file, shared while in flight; a file is remembered for the session, a miss for MISS_MS.
export function isFile($: EngineInterface, path: string): Promise<Stat | null> {
  let hit = files.get(path);
  if (!hit) {
    hit = $.fs.stat(path).then(
      (s) => (s.kind === 'file' ? { size: s.size, mtimeMs: s.mtimeMs } : null),
      () => null,
    );
    files.set(path, hit);
    void hit.then((s) => {
      if (!s) void $.clock.after(MISS_MS, () => files.delete(path));
    });
  }
  return hit;
}

async function home($: EngineInterface): Promise<string | null> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? null;
}

// `text` with every path to an existing .md file (tried against each base in turn) rewritten as a file: link.
export async function linked(
  $: EngineInterface,
  text: string,
  bases: string[],
): Promise<{ text: string; hrefs: string[] }> {
  const found = findPaths(text);
  if (found.length === 0) return { text, hrefs: [] };
  const h = await home($);
  const links = [];
  for (const f of found) {
    for (const base of bases) {
      const abs = resolvePath(f.raw, base, h);
      if (!(await isFile($, abs))) continue;
      const href = toHref(abs);
      if (href.length <= MAX_HREF) links.push({ ...f, href });
      break;
    }
  }
  return { text: linkify(text, links), hrefs: [...new Set(links.map((l) => l.href))].slice(0, MAX_LINKS) };
}

export async function onPress($: EngineInterface, href: string): Promise<void> {
  void $.ui.toast(href);
}

export const register: Register = (on) => {
  files = new Map();

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true || e.props.isSummary) return next(e);
    const { text, hrefs } = await linked($, e.props.text, [await $.session.cwd()]);
    if (hrefs.length === 0 || text.length > MAX_TEXT) return next(e);
    const { Markdown } = $.ui.resolve(e);
    return <Markdown key="reply" text={text} onLinkPress={(link) => onPress($, link.href)} pressableLinks={hrefs} />;
  });
};
