// The current flow run (feature, research, implement, fix, upgrade) in a band above the prompt, with a key to resume it. Only reads; never writes.
import { atom, read, update } from 'claude-code';
import type { CommandInfo, EngineInterface as $, Register } from 'claude-code';

import type { Band, Run } from '../types';
import { bandLines, claimOf, newest, parseFlow, pickCurrent, resumeCommand, slugOf } from './flow';

const POLL_MS = 5000;

const band = atom({ plugin: 'flows', key: 'band' } as const, null);

// Module state: a reload starts it over.
let touched: { slug: string; path: string } | null = null; // the flow.md this session last wrote
let commands: CommandInfo[] = [];
const seen = new Map<string, Run>(); // parsed copies, keyed by path, valid while mtimeMs matches
let busy = false;
let again = false;

const list = ($: $, path: string) => $.fs.list(path).catch(() => []);

// Every flow.md copy: <base>, <base>/.worktrees/*, <base>/.claude/worktrees/*, each docs/features/*/flow.md.
async function copies($: $): Promise<{ path: string; mtimeMs: number }[]> {
  const base = (await $.session.repo())?.root ?? (await $.session.cwd());
  const folders = [base];
  for (const wt of [`${base}/.worktrees`, `${base}/.claude/worktrees`])
    for (const e of await list($, wt)) if (e.kind === 'dir') folders.push(`${wt}/${e.name}`);
  const found: { path: string; mtimeMs: number }[] = [];
  for (const f of folders) {
    for (const d of await list($, `${f}/docs/features`)) {
      if (d.kind !== 'dir') continue;
      const dir = `${f}/docs/features/${d.name}`;
      const file = (await list($, dir)).find((e) => e.name === 'flow.md' && e.kind === 'file');
      if (file) found.push({ path: `${dir}/flow.md`, mtimeMs: file.mtimeMs });
    }
  }
  if (touched) {
    const path = touched.path;
    await $.fs.stat(path).then(
      (s) => found.push({ path, mtimeMs: s.mtimeMs }),
      () => {},
    );
  }
  return found;
}

async function parse($: $, path: string, mtimeMs: number): Promise<Run | null> {
  const hit = seen.get(path);
  if (hit?.mtimeMs === mtimeMs) return hit;
  try {
    const run = { ...parseFlow(await $.fs.read(path)), slug: slugOf(path)!, path, mtimeMs };
    seen.set(path, run);
    return run;
  } catch {
    return null; // a copy that can't be read drops out
  }
}

// The Hypothesis claim of the spec a research run links, read relative to its flow.md; null when there is none.
async function claimFor($: $, run: Run): Promise<string | null> {
  if (!run.research || !run.spec) return null;
  try {
    return claimOf(await $.fs.read(`${run.path.replace(/[^/\\]*$/, '')}${run.spec.split('#')[0]}`));
  } catch {
    return null;
  }
}

async function poll($: $) {
  const runs: Run[] = [];
  for (const c of await copies($)) {
    const run = await parse($, c.path, c.mtimeMs);
    if (run) runs.push(run);
  }
  const { current, others } = pickCurrent(newest(runs), touched?.slug ?? null);
  const value: Band | null = current && {
    run: current,
    others,
    showKey: touched?.slug !== current.slug && current.phase !== 'done',
    command: resumeCommand(commands, current.flow),
    claim: await claimFor($, current),
  };
  await update($, band, () => value);
}

async function refresh($: $) {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    do {
      again = false;
      await poll($);
    } while (again);
  } finally {
    busy = false;
  }
}

export const register: Register = (on) => {
  touched = null;
  commands = [];
  seen.clear();
  busy = false;
  again = false;

  on('session.start', async ($, e, next) => {
    try {
      commands = await $.command.list();
    } catch {
      // no resume key without the command
    }
    $.clock.every(POLL_MS, () => void refresh($).catch(() => {}));
    void refresh($).catch(() => {});
    return next(e);
  });

  // A /clear ends the session too (no session.start follows): the runs it wrote stop being this session's.
  on('session.end', ($, e, next) => {
    touched = null;
    void refresh($).catch(() => {});
    return next(e);
  });

  // Write and Edit (subagents' too) that went through: that run is this session's.
  for (const tool of ['Write', 'Edit'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const r = await next(e);
      const slug = slugOf(e.file_path);
      if (slug && r.deny === undefined && r.isError !== true) {
        touched = { slug, path: e.file_path };
        void refresh($).catch(() => {});
      }
      return r;
    }).catch((_$, e, next) => next(e));
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, band); // the read is what redraws on update
    if (b === null || e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e);
    const below = await next(e);
    if ((below as { type?: unknown }).type !== 'engine') return below; // a hook beneath drew a band
    const { Box, Button, Text } = $.ui.resolve(e);
    const cmd = b.command;
    const resume = () =>
      $.command.run({ command: cmd!, args: b.run.slug }).then(
        () => {},
        (err: unknown) =>
          $.ui.toast(`Couldn't resume ${b.run.slug}: ${err instanceof Error ? err.message : String(err)}`),
      );
    return (
      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          {bandLines(b.run, b.others, e.props.bodyColumns, b.claim).map((line) => (
            <Text>{line}</Text>
          ))}
        </Box>
        {b.showKey && !e.props.isWorking && cmd ? (
          <Button key="resume" hotkey="1" plain onPress={resume}>
            resume
          </Button>
        ) : null}
      </Box>
    );
  });
};
