import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register, Timer } from 'claude-code';

import type { Doc } from '../types';
import { findPaths, fromHref, linkify, resolvePath, toHref } from './paths';

export const PANE = 'md-pane';
// Under the engine's 100 000 characters per drawing; past it a Markdown's pressable links are dropped.
const MAX_TEXT = 99_000;
const MAX_LINKS = 256;
const MAX_HREF = 2048;
const MISS_MS = 2000;
const MAX_FILE = 4 * 1024 * 1024;
const REFRESH_MS = 1000;
const CUT_NOTE = '\n\n_Cut at 99 000 characters; open the file elsewhere for the rest._';

export const doc = atom({ plugin: 'md-pane', key: 'doc' } as const, null as Doc | null);

type Stat = { size: number; mtimeMs: number };

// Module state, reset by `register` so a reload (and each test) starts clean.
let files = new Map<string, Promise<Stat | null>>();
// Bumped by every press and close: a load that finishes after the counter moved is dropped.
let generation = 0;
let timer: Timer | null = null;
let ticking = false;

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

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirname = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
const why = (err: unknown) =>
  /ENOENT/.test(String(err)) ? 'not found' : err instanceof Error ? err.message : String(err);

// The document at `path`, its links rewritten and cut to fit one drawing; never throws.
export async function load($: EngineInterface, path: string): Promise<Doc> {
  const empty: Doc = { path, shown: null, hrefs: [], error: null, mtimeMs: 0, size: 0 };
  let stamp: Doc;
  try {
    const s = await $.fs.stat(path);
    stamp = { ...empty, mtimeMs: s.mtimeMs, size: s.size };
    if (s.kind !== 'file') return { ...stamp, error: 'not a file' };
    if (s.size > MAX_FILE) return { ...stamp, error: 'larger than 4 MiB' };
  } catch (err) {
    return { ...empty, error: why(err) };
  }
  try {
    const raw = await $.fs.read(path);
    let { text, hrefs } = await linked($, raw, [dirname(path), await $.session.cwd()]);
    if (text.length > MAX_TEXT) {
      const line = text.lastIndexOf('\n', MAX_TEXT);
      text = text.slice(0, line > 0 ? line : MAX_TEXT) + CUT_NOTE;
      hrefs = hrefs.filter((h) => text.includes(h));
    }
    return { ...stamp, shown: text, hrefs };
  } catch (err) {
    return { ...stamp, error: why(err) };
  }
}

export async function onPress($: EngineInterface, href: string): Promise<void> {
  const path = fromHref(href);
  const gen = ++generation;
  const open = (await $.state.get({ plugin: 'md-pane', key: 'doc' })).value;
  const swap = open?.path !== path;
  if (swap) {
    const fresh = await load($, path);
    if (gen !== generation) return;
    // Re-checked inside the write: a close that lands while it waits wins.
    await update($, doc, (cur) => (gen === generation ? fresh : cur));
  }
  if (gen !== generation) return;
  await $.ui.open({ id: PANE, title: basename(path), focus: true, closeOnEscape: true });
  // The test kit has no ui.scroll; a swapped document should still start at its top.
  if (swap) void $.ui.scroll({ in: PANE, to: 'start' }).catch(() => {});
}

function unwatch(): void {
  timer?.cancel();
  timer = null;
}

// One refresh: re-load the open document when its stat changed, unless a press or close moved on meanwhile.
async function tick($: EngineInterface): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const open = (await $.state.get({ plugin: 'md-pane', key: 'doc' })).value;
    if (!open) return unwatch();
    const gen = generation;
    const now = await $.fs.stat(open.path).then(
      (s) => `${s.mtimeMs}:${s.size}`,
      () => 'gone',
    );
    const was = open.error === 'not found' ? 'gone' : `${open.mtimeMs}:${open.size}`;
    if (now === was) return;
    const fresh = await load($, open.path);
    if (gen === generation) await update($, doc, (cur) => (cur?.path === open.path ? fresh : cur));
  } finally {
    ticking = false;
  }
}

export async function close($: EngineInterface): Promise<void> {
  unwatch();
  generation++;
  await $.ui.close({ id: PANE });
  await update($, doc, () => null);
}

export const register: Register = (on) => {
  files = new Map();
  generation = 0;
  timer = null;
  ticking = false;

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true || e.props.isSummary) return next(e);
    const { text, hrefs } = await linked($, e.props.text, [await $.session.cwd()]);
    if (hrefs.length === 0 || text.length > MAX_TEXT) return next(e);
    const { Markdown } = $.ui.resolve(e);
    return <Markdown key="reply" text={text} onLinkPress={(link) => onPress($, link.href)} pressableLinks={hrefs} />;
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown, Button } = $.ui.resolve(e);
    const open = await read($, doc);
    if (!open) return <Text dimColor>Nothing open.</Text>;
    timer ??= $.clock.every(REFRESH_MS, () => void tick($));
    const name = basename(open.path);
    return (
      <Box flexDirection="column">
        <Text key="title" bold>
          {name}
        </Text>
        {open.shown === null ? (
          <Text key="message" dimColor>{`Can't show ${name}: ${open.error}.`}</Text>
        ) : (
          <Markdown
            key="doc"
            text={open.shown}
            onLinkPress={(link) => onPress($, link.href)}
            pressableLinks={open.hrefs}
          />
        )}
        <Button key="q" plain hotkey="q" label="close" onPress={() => close($)} />
      </Box>
    );
  });

  on('ui.close', { id: PANE }, async ($, e, next) => {
    unwatch();
    generation++;
    await update($, doc, () => null);
    return next(e);
  });

  on('session.end', async ($, e, next) => {
    await close($);
    return next(e);
  });
};
