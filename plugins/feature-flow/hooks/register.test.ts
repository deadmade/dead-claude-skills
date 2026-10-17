import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';
import type { Engine } from 'claude-code/testing';

type Files = Record<string, { text: string | null; mtimeMs: number }>; // text null: listed, but the read fails
type Answer = Record<string, unknown>;

const flow = (phase: string) => `---\nphase: ${phase}\n---\n\n## Gates\n\n- Gate 1, spec approved:\n`;
const research = (spec = '- Spec: [spec.md](spec.md)') =>
  `---\nflow: research\nphase: validate\n---\n\n## Artifacts\n\n${spec}\n\n## Results\n\n| run | command | numbers | date |\n| - | - | - | - |\n| baseline | x | 412ms | d |\n\nVerdict: supported\n`;
const SPEC = '## Hypothesis\n\n- **Claim:** caching cuts p95 by 30%\n';
const START = { cwd: '/repo', surface: null, isInteractive: true } as const;
const COMMANDS = [
  { name: 'feature-flow:feature-flow', description: '', source: 'plugin', plugin: 'feature-flow' },
  { name: 'feature-flow:research-flow', description: '', source: 'plugin', plugin: 'feature-flow' },
];

// Fakes the host: a file tree from `files` (directories implied by the paths), the repo, commands, toasts, tool calls.
function host(
  on: On,
  files: Files,
  { root = '/repo' as string | null, cwd = '/repo', repoFails = 0, below = null as string | null } = {},
) {
  const clock = mock.clock(on);
  const runs: { command: string; args: string }[] = [];
  const toasts: string[] = [];
  const h = { clock, runs, toasts, files, tool: { result: 'ok' } as Answer, isUnknown: false };
  let repoCalls = 0;
  on('session.start', () => ({ cwd }));
  on('session.repo', () =>
    ++repoCalls <= repoFails
      ? { deny: 'git failed' }
      : { value: root ? { root, remote: null, internal: false } : null },
  );
  on('session.cwd', () => ({ value: cwd }));
  on('fs.list', (_$, e) => {
    const dir = `${e.path}/`;
    const names = new Map<string, string>();
    for (const p of Object.keys(h.files)) {
      if (!p.startsWith(dir)) continue;
      const [name, ...rest] = p.slice(dir.length).split('/');
      names.set(name!, rest.length ? 'dir' : 'file');
    }
    if (!names.size) return { deny: 'ENOENT' };
    return {
      value: [...names].map(([name, kind]) => ({
        name,
        kind,
        size: 0,
        mtimeMs: kind === 'file' ? h.files[dir + name]!.mtimeMs : 0,
        isLink: false,
      })),
    } as never;
  });
  on('fs.read', (_$, e) => {
    const text = h.files[e.path]?.text;
    return typeof text === 'string' ? { value: text } : { deny: 'EACCES' };
  });
  on('fs.stat', (_$, e) =>
    h.files[e.path]
      ? ({ value: { kind: 'file', size: 0, mtimeMs: h.files[e.path]!.mtimeMs } } as never)
      : { deny: 'ENOENT' },
  );
  on('command.list', () => ({ value: COMMANDS }) as never);
  on('command.run', (_$, e) => {
    runs.push({ command: e.command, args: e.args });
    if (h.isUnknown) throw new Error('unknown command'); // the engine rejects an unknown name
    return { text: '' };
  });
  on('ui.toast', (_$, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on('tool.call', () => h.tool as never);
  on('ui.render', { component: 'AbovePrompt' }, ($, e) =>
    below === null ? ({ type: 'engine', ref: 0 } as never) : ($.ui.resolve(e).Text({ children: below }) as never),
  );
  return h;
}

async function start($: Engine, h: ReturnType<typeof host>) {
  await $.session.start(START);
  await h.clock.settle();
}

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
};

function band($: Engine, props: Partial<typeof PROPS> = {}, surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({
    plugin: 'feature-flow',
    surface,
    component: 'AbovePrompt',
    props: { ...PROPS, ...props },
  } as never);
}

async function shown($: Engine, props: Partial<typeof PROPS> = {}) {
  const ui = await band($, props);
  const texts = (await ui.findAll({ type: 'Text' })).map((t) => t.text).join('\n');
  const resume = await ui.find({ key: 'resume' });
  await ui.unmount();
  return { texts, resume };
}

const write = ($: Engine, file_path: string, tool = 'Write', agentId?: string) =>
  $.tool.call({ tool, file_path, content: '', old_string: '', new_string: '', agentId } as never).catch(() => {});

test('no runs: nothing of ours is drawn', async ($, on) => {
  const h = host(on, { '/repo/README.md': { text: '', mtimeMs: 1 } });
  await start($, h);
  expect(await shown($)).toEqual({ texts: '', resume: undefined });
});

test('a worktree copy wins', async ($, on) => {
  const h = host(on, {
    '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 1 },
    '/repo/.worktrees/wt/docs/features/a/flow.md': { text: flow('execute'), mtimeMs: 2 },
  });
  await start($, h);
  const { texts } = await shown($);
  expect(texts).toContain('a · execute');
  expect(texts).not.toContain('open');
});

test('a .claude/worktrees copy is scanned too', async ($, on) => {
  const h = host(on, { '/repo/.claude/worktrees/x/docs/features/z/flow.md': { text: flow('ground'), mtimeMs: 1 } });
  await start($, h);
  expect((await shown($)).texts).toContain('z · ground');
});

test('started inside a worktree: the main tree runs count', async ($, on) => {
  const h = host(
    on,
    {
      '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 1 },
      '/repo/docs/features/b/flow.md': { text: flow('spec'), mtimeMs: 2 },
    },
    { cwd: '/repo/.worktrees/wt' },
  );
  await start($, h);
  const { texts } = await shown($);
  expect(texts).toContain('b · spec');
  expect(texts).toContain('+1 open');
});

test('no repository: the scan uses cwd', async ($, on) => {
  const h = host(
    on,
    { '/work/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 1 } },
    { root: null, cwd: '/work' },
  );
  await start($, h);
  expect((await shown($)).texts).toContain('a · plan');
});

test('follows edits', async ($, on) => {
  const h = host(on, { '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 1 } });
  await start($, h);
  h.files['/repo/docs/features/a/flow.md'] = { text: flow('execute'), mtimeMs: 2 };
  await h.clock.advance(5000);
  expect((await shown($)).texts).toContain('a · execute');
});

test('copies drop out', async ($, on) => {
  const h = host(on, {
    '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 1 },
    '/repo/.worktrees/wt/docs/features/a/flow.md': { text: flow('execute'), mtimeMs: 2 },
    '/repo/.worktrees/wt2/docs/features/a/flow.md': { text: null, mtimeMs: 3 },
  });
  await start($, h);
  expect((await shown($)).texts).toContain('a · execute');
  delete h.files['/repo/.worktrees/wt/docs/features/a/flow.md'];
  await h.clock.advance(5000);
  expect((await shown($)).texts).toContain('a · plan');
});

test('survives a failed poll', async ($, on) => {
  const h = host(on, { '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 1 } }, { repoFails: 1 });
  await start($, h);
  expect((await shown($)).texts).toBe('');
  await h.clock.advance(5000);
  expect((await shown($)).texts).toContain('a · plan');
});

test("this session's write wins", async ($, on) => {
  const h = host(on, {
    '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 3 },
    '/repo/docs/features/b/flow.md': { text: flow('spec'), mtimeMs: 1 },
    '/repo/docs/features/c/flow.md': { text: flow('ground'), mtimeMs: 2 },
  });
  await start($, h);
  expect((await shown($)).texts).toContain('a · plan');
  await write($, '/repo/docs/features/b/flow.md');
  await h.clock.advance(5000);
  const b = await shown($);
  expect(b.texts).toContain('b · spec');
  expect(b.resume).toBeUndefined();
  await write($, '/repo/docs/features/c/flow.md', 'Edit', 'x');
  await h.clock.advance(5000);
  const c = await shown($);
  expect(c.texts).toContain('c · ground');
  expect(c.resume).toBeUndefined();
});

test("a refused or failed write doesn't count", async ($, on) => {
  const h = host(on, {
    '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 2 },
    '/repo/docs/features/b/flow.md': { text: flow('spec'), mtimeMs: 1 },
  });
  await start($, h);
  h.tool = { deny: 'no' };
  await write($, '/repo/docs/features/b/flow.md');
  h.tool = { isError: true, result: 'x' };
  await write($, '/repo/docs/features/b/flow.md');
  await h.clock.advance(5000);
  const s = await shown($);
  expect(s.texts).toContain('a · plan');
  expect(s.resume).toBeDefined();
});

test('a write outside the scanned folders', async ($, on) => {
  const h = host(on, {
    '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 2 },
    '/elsewhere/docs/features/c/flow.md': { text: flow('spec'), mtimeMs: 1 },
  });
  await start($, h);
  await write($, '/elsewhere/docs/features/c/flow.md');
  await h.clock.settle();
  expect((await shown($)).texts).toContain('c · spec');
});

test('resume', async ($, on) => {
  const h = host(on, { '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 1 } });
  await start($, h);
  const ui = await band($);
  expect((await ui.find({ key: 'resume' }))?.props.hotkey).toBe('1');
  await ui.press({ key: 'resume' });
  expect(h.runs).toEqual([{ command: 'feature-flow:feature-flow', args: 'a' }]);
  h.isUnknown = true;
  await ui.press({ key: 'resume' });
  expect(h.toasts).toHaveLength(1);
  await ui.unmount();
});

test('no key while working', async ($, on) => {
  const h = host(on, { '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 1 } });
  await start($, h);
  const s = await shown($, { isWorking: true });
  expect(s.texts).toContain('a · plan');
  expect(s.resume).toBeUndefined();
});

test('yields to a survey and an agent view', async ($, on) => {
  const h = host(on, { '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 1 } });
  await start($, h);
  expect((await shown($, { hasSurvey: true })).texts).toBe('');
  expect((await shown($, { view: { agentId: 'x' } as never })).texts).toBe('');
});

test('yields to a band beneath', async ($, on) => {
  const h = host(on, { '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 1 } }, { below: 'theirs' });
  await start($, h);
  expect(await shown($)).toEqual({ texts: 'theirs', resume: undefined });
});

test('lays the line out to bodyColumns', async ($, on) => {
  const h = host(on, { '/repo/docs/features/a-rather-long-slug/flow.md': { text: flow('plan'), mtimeMs: 1 } });
  await start($, h);
  const ui = await band($, { bodyColumns: 30 });
  const line = (await ui.find({ type: 'Text' }))!.text;
  expect(line.length).toBeLessThanOrEqual(20);
  expect(line).toContain('a-rather-long-slug');
  await ui.unmount();
});

test('each surface gets a line for its own width', async ($, on) => {
  const h = host(on, { '/repo/docs/features/a-rather-long-slug/flow.md': { text: flow('plan'), mtimeMs: 1 } });
  await start($, h);
  const terminal = await band($, { bodyColumns: 30 }, 'terminal');
  const desktop = await band($, { bodyColumns: 50 }, 'desktop');
  const line = async (ui: typeof terminal) => (await ui.find({ type: 'Text' }))!.text;
  expect((await line(terminal)).length).toBeLessThanOrEqual(20);
  expect((await line(desktop)).length).toBeLessThanOrEqual(40);
  expect((await line(desktop)).length).toBeGreaterThan(20);
  await terminal.unmount();
  await desktop.unmount();
});

test('the key comes back when the written run is gone', async ($, on) => {
  const h = host(on, {
    '/repo/docs/features/a/flow.md': { text: flow('plan'), mtimeMs: 1 },
    '/repo/docs/features/b/flow.md': { text: flow('spec'), mtimeMs: 2 },
  });
  await start($, h);
  await write($, '/repo/docs/features/a/flow.md');
  await h.clock.settle();
  expect((await shown($)).resume).toBeUndefined();
  delete h.files['/repo/docs/features/a/flow.md'];
  await h.clock.advance(5000);
  const s = await shown($);
  expect(s.texts).toContain('b · spec');
  expect(s.resume).toBeDefined();
});

test('a done run shows without the key', async ($, on) => {
  const h = host(on, { '/repo/docs/features/a/flow.md': { text: flow('done'), mtimeMs: 1 } });
  await start($, h);
  await write($, '/repo/docs/features/a/flow.md');
  await h.clock.settle();
  const s = await shown($);
  expect(s.texts).toContain('a · done');
  expect(s.resume).toBeUndefined();
});

test('session end (a /clear too) forgets the written run', async ($, on) => {
  const h = host(on, {
    '/repo/docs/features/a/flow.md': { text: flow('done'), mtimeMs: 1 },
    '/repo/docs/features/b/flow.md': { text: flow('spec'), mtimeMs: 2 },
  });
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  await start($, h);
  await write($, '/repo/docs/features/a/flow.md');
  await h.clock.settle();
  expect((await shown($)).texts).toContain('a · done');
  await $.session.end({ reason: 'clear', sessionId: 's' } as never);
  await h.clock.settle();
  const s = await shown($);
  expect(s.texts).toContain('b · spec');
  expect(s.resume).toBeDefined();
});

test('research line', async ($, on) => {
  const h = host(on, {
    '/repo/docs/features/r/flow.md': { text: research(), mtimeMs: 1 },
    '/repo/docs/features/r/spec.md': { text: SPEC, mtimeMs: 1 },
  });
  await start($, h);
  const { texts } = await shown($);
  expect(texts).toContain('r · validate');
  expect(texts).toContain('caching cuts p95 by 30% · baseline 412ms · supported');
});

test('spec unreadable: no claim, first line still drawn', async ($, on) => {
  const h = host(on, {
    '/repo/docs/features/r/flow.md': { text: research(), mtimeMs: 1 },
    '/repo/docs/features/r/spec.md': { text: null, mtimeMs: 1 },
  });
  await start($, h);
  const { texts } = await shown($);
  expect(texts).toContain('r · validate');
  expect(texts).toContain('baseline 412ms · supported');
  expect(texts).not.toContain('caching');
});
