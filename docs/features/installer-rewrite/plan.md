# Installer rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the clack UI with a zero-dependency framed start screen (category lines with current values,
updates, changes-only review) on Node's stdlib, and add updating outdated plugins.

**Architecture:** `installer/core.mjs` gains one pure function (`outdated`). New `installer/view.mjs` is pure:
`frame`, `wrap`, `changeList`, the screen state machine `move`, and `render` for the start, category, updates and
review screens. New `installer/ui.mjs` is the only code touching the TTY (`screen`, `confirm`, `line`, `note`,
`progress`, `log`). `installer/install.mjs` swaps every `p.*` call for `ui.mjs`; `tabs.mjs`, the dependencies and
`npm-shrinkwrap.json` go.

**Tech Stack:** Node >=20.12 ESM, `node:readline` + `node:readline/promises`, TTY raw mode, `node:util`
`styleText` / `stripVTControlCharacters`, `node:test`. No npm packages.

**Spec:** [spec.md](spec.md)

## Global Constraints

- No npm dependency: `package.json` has no `dependencies`; no file imports anything but `node:*` and local files.
- Colors only via `styleText` with the 16 standard names (`red green yellow blue magenta cyan white` + `bold`,
  `inverse`). Never `dim` / `gray`. Frame + accent: `magenta`. Category colors by `id`: `workflow` cyan, `lsp`
  yellow, `mcp` blue, `tools` green, `system` magenta, `danger` red, `other` white.
- Unicode always: frame `╭ ─ ╮ │ ╰ ╯`, cursor `❯`, dot `●`, `+`, `−` (U+2212), `→`, `←`, `↑`, `✓`, `✗`. No ASCII
  fallback, no NO_COLOR code.
- Keys: ↑/↓, enter (`return` or `enter`), esc, ctrl-c; ←/→ also on the review row and in `confirm`; y/n only in
  `confirm`. No `a`, no space.
- Copy exactly as the spec: `will install`, `will remove (installed X)`, `not installed`, `installed X`,
  `installed X, disabled`, `outdated X → Y`, `will update`, `skip`, `will turn on`, `will turn off`, `on`, `off`,
  `none`, `← Back`, `Apply N changes`, `Nothing to change`, `Quit`, `↑ N updates`, `This will change`,
  `Quit without applying N changes?`, `Cancelled before installing anything.`, `Type "clean" to continue:`.
- Every rendered line's visible width (`stripVTControlCharacters(l).length`) ≤ `columns - 1` (a full-width line
  makes some terminals wrap, which breaks the redraw count); line count ≤ `rows`.
- Tests: `node --test installer/*.test.mjs`. `view.test.mjs` sets `process.env.FORCE_COLOR = '1'` as its first
  statement and imports dynamically (as `tabs.test.mjs` does today) so color asserts see escape codes.
- Commit messages are one sentence, no co-author lines.

## Review Focus

1. Terminal narrower than the frame needs (columns = 20): render must not throw and every line ≤ 19. Test in Task 3.
2. Short terminal (rows = 12) on a 7-item category with a long description: ≤ 12 lines and the cursor row is
   among them. Test in Task 3.
3. An error thrown inside a key handler, or ctrl-c (in `screen`, `confirm` and `line`): raw mode is off, the cursor
   shown, stdin paused. Test in Task 4.
4. Unticking an outdated plugin (removing it) drops it from Updates, the Apply count and the review's Update group.
   Test in Task 2.
5. Nothing pending: the button reads `Nothing to change`, the review says `Nothing to change.` and Apply still
   proceeds (settings and brv are re-checked as today). Tests in Tasks 2 and 3.

---

### Task 1: `outdated` in core

**Files:**

- Modify: `installer/core.mjs` (append after `unavailable`), `installer/core.test.mjs`

**Interfaces:**

- Produces: `outdated(rows, shipped) -> [{ id, from, to }]`.
  - `rows`: the normalised `claude plugin list --json` array (`{ id, version, scope }`).
  - `shipped`: `{ [pluginName]: version }` for local plugins of this repo.
  - Returns one row per id (deduped; first wins) whose id ends in `@dead-claude-skills`, whose name is in `shipped`,
    and whose version differs, in `rows` order.
  - An installed version that is plain `X.Y.Z` and numerically newer than the shipped `X.Y.Z` is not outdated. A
    git-sha or other non-semver version that differs is.

- [ ] **Step 1: Write the failing test** in `core.test.mjs`:

```js
test('outdated compares our shipped versions only, once per id, never downgrading', () => {
  const rows = [
    { id: `cswap@${M}`, version: '0.1.0', scope: 'user' },
    { id: `cswap@${M}`, version: '0.1.0', scope: 'project' },
    { id: `feature-flow@${M}`, version: '0.1.1' },
    { id: `graphify@${M}`, version: '29c78da38ecf' },
    { id: `hallmark@${M}`, version: '0.2.0' },
    { id: `superpowers@${M}`, version: '6.4.2' },
    { id: `code-review@${O}`, version: '1.0.0' },
  ];
  const shipped = {
    cswap: '0.1.1',
    'feature-flow': '0.1.1',
    graphify: '0.1.1',
    hallmark: '0.1.1',
    'code-review': '9.9.9',
  };
  assert.deepEqual(outdated(rows, shipped), [
    { id: `cswap@${M}`, from: '0.1.0', to: '0.1.1' },
    { id: `graphify@${M}`, from: '29c78da38ecf', to: '0.1.1' },
  ]);
});
```

- [ ] **Step 2: Run** `node --test installer/core.test.mjs`. Expected: FAIL, `outdated` is not exported.
- [ ] **Step 3: Implement** `outdated` in `core.mjs`, exported, pure.
- [ ] **Step 4: Run** `node --test installer/core.test.mjs`. Expected: all pass.
- [ ] **Step 5: Commit** `git add installer/core.mjs installer/core.test.mjs && git commit -m "Add outdated to the installer core."`

---

### Task 2: `view.mjs`: frame, wrap, changeList, state machine

**Files:**

- Create: `installer/view.mjs`, `installer/view.test.mjs`

**Interfaces:**

- Consumes: `nameOf`, `TOGGLES`, `HINTS` from `core.mjs`.
- Produces:
  - `frame(title, lines, { columns, color = 'magenta' }) -> string[]`: a rounded box `columns - 1` wide. The top is
    `╭─ title ───╮`, each body line is `│ <line> │`, the bottom is `╰───╯`. A line whose visible width exceeds the
    inner width is replaced by its plain text cut to fit plus `…`; that line loses its color, and there is no
    escape-code-aware slicing. Used for screens.
  - `wrap(text, width) -> string[]`: word-wraps plain text and hard-breaks words longer than `width`. `note` (Task 4)
    wraps its lines with this before framing, so copyable text is never cut.
  - `data`: `{ version, platform, pages, current, versions: { [key]: string }, disabled: { [key]: true },
tokens: string[], describe(key) -> { label, detail }, updates: [{ id, from, to }], core: string,
hidden: [{ key, why }] }`. `pages` is `categorize()` output; `platform` is `${process.platform}-${process.arch}`.
  - `state`: `{ screen: 'start' | 'category' | 'updates' | 'review', cursor: number, page: number, chosen, skip,
result? }`. `initial(chosen) -> state` starts at `screen: 'start', cursor: 0, page: 0, skip: {}`.
  - `changeList(state, data) -> { install, remove, update, on, off, danger, count, unchanged }`. `keys` is
    `data.pages.flatMap((p) => p.keys)`.
    - `install` / `remove`: plugin keys (not in `TOGGLES`) where `chosen` and `current` differ.
    - `on` / `off`: `TOGGLES` except `strip-defaults` and `clean`.
    - `danger`: `strip-defaults` / `clean` chosen and not current.
    - `update`: the `data.updates` rows not in `skip` whose plugin is still chosen (`chosen[id] ?? true`, since bundle
      ids are never in `chosen`).
    - `count`: the total of all six.
    - `unchanged`: `{ installed, notInstalled }` counts over `keys` with no change.
  - `move(state, key, data) -> state`. `key`: keypress names `'up' | 'down' | 'left' | 'right' | 'return' | 'escape'`
    (ui maps `enter` to `return`). It sets `result` to `'apply'`, `'quit'` or `'ask-quit'` when the screen should
    end.

Rows on each screen:

- **Start:** one row per page, then `Updates` (shown when `data.updates` has a row for a still-chosen plugin), then
  `Apply`, then `Quit`. The `Core` line isn't a row; the cursor skips it.
- **Category:** `← Back`, then the page's keys.
- **Updates:** `← Back`, then one row per `data.updates` entry whose plugin is still chosen. It uses the same
  row/toggle logic as a category; the only difference is that enter flips `skip[id]`.
- **Review:** `Apply`, `Back`, `Quit`. ←/→ and ↑/↓ both move.

- [ ] **Step 1: Write the failing tests** (`view.test.mjs`, FORCE_COLOR header as in Global Constraints). Use a
      small fixture:
  - two pages, `mcp` (`mcp-azure@…`, `mcp-github@…`, `atlassian@…`) and `system` (`sandbox`, `ccstatusline`);
  - `current` with atlassian and sandbox on;
  - one update for atlassian (`0.1.0 → 0.1.1`).

```js
test('changeList groups changes and drops updates of removed plugins', () => {
  const s = { ...initial(chosen), chosen: { ...chosen, [azure]: true, [atlassian]: false, ccstatusline: true } };
  const r = changeList(s, data);
  assert.deepEqual(
    [r.install, r.remove, r.on, r.off, r.danger, r.update],
    [[azure], [atlassian], ['ccstatusline'], [], [], []],
  );
  assert.equal(r.count, 3);
  assert.deepEqual(r.unchanged, { installed: 1, notInstalled: 1 });
});
test('changeList respects skip and counts nothing when idle', () => {
  assert.equal(changeList({ ...initial(chosen), skip: { [atlassian]: true } }, data).count, 0);
  assert.equal(changeList(initial(chosen), data).count, 1); // the update
});
test('down/up wrap over start rows: pages, Updates, Apply, Quit', () => {
  const s = move(initial(chosen), 'up', data);
  assert.equal(s.cursor, 4);
  assert.equal(move(s, 'down', data).cursor, 0);
});
test('enter on a page opens it, esc returns with the page row focused', () => {
  const s = move(initial(chosen), 'return', data);
  assert.deepEqual([s.screen, s.page, s.cursor], ['category', 0, 0]);
  const back = move(s, 'escape', data);
  assert.deepEqual([back.screen, back.cursor], ['start', 0]);
});
test('enter on an item toggles it, again undoes it; enter on ← Back returns', () => {
  /* mcp-azure true, then false; cursor 0 + return → start */
});
test('updates rows toggle skip; removing the plugin hides its row', () => {
  /* open Updates, down, return → skip[atlassian] true */
});
test('esc on start: quit when idle, ask-quit with changes', () => {
  const idle = { ...initial(chosen), skip: { [atlassian]: true } };
  assert.equal(move(idle, 'escape', data).result, 'quit');
  assert.equal(move(initial(chosen), 'escape', data).result, 'ask-quit');
});
test('Apply opens review; review Apply/Back/Quit', () => {
  /* cursor on Apply → return → screen 'review', cursor 0; return → result 'apply';
     right + return → screen 'start', chosen kept; right, right, return → result 'quit' */
});
test('frame cuts long lines and stays one under the width; wrap never cuts', () => {
  const out = frame('T', ['x'.repeat(100)], { columns: 30 });
  assert.ok(out.every((l) => plain(l).length === 29));
  assert.ok(plain(out[1]).includes('…'));
  assert.equal(
    wrap('https://github.com/settings/personal-access-tokens/new', 20).join(''),
    'https://github.com/settings/personal-access-tokens/new',
  );
});
```

- [ ] **Step 2: Run** `node --test installer/view.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `frame`, `wrap`, `initial`, `changeList` and `move` in `installer/view.mjs`.
- [ ] **Step 4: Run** `node --test installer/view.test.mjs`. Expected: all pass.
- [ ] **Step 5: Commit** `git add installer/view.mjs installer/view.test.mjs && git commit -m "Add the installer's pure screen state machine and frame."`

---

### Task 3: `render` for the four screens

**Files:**

- Modify: `installer/view.mjs`, `installer/view.test.mjs`

**Interfaces:**

- Consumes: Task 2's `frame`, `wrap`, `state`, `data` and `changeList`.
- Produces: `render(state, data, { columns, rows }) -> string[]`. It returns lines with no trailing newline; ui joins
  them with `\n`.

The layout follows the spec's mockups (Start screen, Category screen, Updates screen, Review screen).

**Start screen:**

- A frame titled `dead-claude-skills <version>`, then the `Core` line (`data.core`).
- One line per page: `● <title padded to the longest title>  <value>`. The dot and title use the page color; Danger
  is red.
- The value is built as follows:
  - kept names: plain
  - pending installs: `+ name` in green
  - pending removals: `− name` in red
  - toggles: `<label> on|off`, where the label for `ccstatusline` is `status line`
  - an empty page: `none`
  - an untouched danger page: `off`
- A blank line, then `↑ N updates` in yellow when there are any.
- Under the frame:
  - `Apply N changes` (green, `inverse`, bold), or `Nothing to change`
  - then `Quit`
  - then the key hint `↑↓ move  enter open  esc quit`
- The cursor row gets `❯` in bold magenta.

**Category screen:**

- A frame titled with the page title in its color, then the blurb, then a blank line.
- One row per item, with the state word from the spec's Category screen:
  - versions come from `data.versions`
  - `, disabled` is appended when the item is in `data.disabled`
  - `outdated X → Y` shows when the key has an update and no pending change
- A blank line, then the focused item's `describe(key).detail`, wrapped with `wrap` to the inner width. Nothing is
  shown on `← Back`.
- Hint: `↑↓ move  enter install/remove  esc back`.
- Danger item names are red, and `strip-defaults` adds `one-way, nothing to undo` to its detail.

**Updates screen:**

- The same code path as a category, with the frame titled `Updates`.
- Each row is `name  from → to  will update|skip`, with `will update` in yellow and `skip` in the normal color.
- Hint: `↑↓ move  enter update/skip  esc back`.

**Review screen:**

- A frame titled `This will change`, with one line per non-empty group:
  - `Install` and `Turn on`: green
  - `Remove` and `Turn off`: red
  - `Update`: yellow, as `name  from → to` with the names aligned
  - `Danger`: red bold, with the `HINTS` text
- Plugins in `data.tokens` get ` (finish in Claude Code)`.
- With no changes, the body is `Nothing to change.`
- A blank line, then `Unchanged: N installed, M not installed`.
- When `data.hidden` is non-empty: `Not available on <data.platform>: name (why), …`.
- Under the frame, the row `Apply N changes    Back    Quit`, with `❯` on the focused choice.

**Scrolling:** when there are more rows than `rows` allows, the list scrolls and keeps the cursor row visible. The
frame, title and hint are always shown.

- [ ] **Step 1: Write the failing tests**:

```js
test('start shows kept, pending + and −, none and the Apply count', () => {
  const s = { ...initial(chosen), chosen: { ...chosen, [azure]: true, [atlassian]: false } };
  const lines = render(s, data, { columns: 80, rows: 30 });
  assert.match(lines.map(plain).join('\n'), /Integrations\s+\+ mcp-azure {2}− atlassian/);
  assert.match(lines.map(plain).join('\n'), /Apply 2 changes/);
  assert.ok(lines.join('\n').includes('\x1b[32m+ mcp-azure'));
});
test('idle start reads Nothing to change; review says Nothing to change.', () => {
  /* skip the update first */
});
test('category states are words', () => {
  /* will install, will remove (installed 0.1.0), not installed, installed 0.1.0, installed 0.1.0, disabled */
});
test('review lists only non-empty groups, token note and platform', () => {
  /* Install + Remove, no "Turn on"; "(finish in Claude Code)"; "Not available on linux-x64" */
});
test('every line fits narrow terminals', () => {
  for (const columns of [20, 40])
    for (const screen of ['start', 'category', 'updates', 'review'])
      assert.ok(
        render({ ...initial(chosen), screen }, data, { columns, rows: 30 }).every(
          (l) => plain(l).length <= columns - 1,
        ),
      );
});
test('short terminals scroll the list and keep the cursor row', () => {
  /* 7-item page, rows 12, cursor 6 → lines.length <= 12 and the focused label is in the output */
});
```

- [ ] **Step 2: Run** `node --test installer/view.test.mjs`. Expected: new tests FAIL, `render` not exported.
- [ ] **Step 3: Implement** `render` in `installer/view.mjs`.
- [ ] **Step 4: Run** `node --test installer/view.test.mjs`. Expected: all pass.
- [ ] **Step 5: Commit** `git add installer/view.mjs installer/view.test.mjs && git commit -m "Render the installer's start, category, updates and review screens."`

---

### Task 4: `ui.mjs`, the terminal I/O

**Files:**

- Create: `installer/ui.mjs`, `installer/ui.test.mjs`

**Interfaces:**

- Consumes: `frame` and `wrap` (Task 2).
- Produces:
  - `screen(state, { move, render }, io = { input: process.stdin, output: process.stdout }) -> Promise<state>`. It
    resolves the first state that has a `result`.
    - Setup: `readline.createInterface({ input, escapeCodeTimeout: 50, terminal: true })`. Pass no `output`, so
      typed keys aren't echoed over the frame. The interface sets up keypress events itself, with the 50 ms esc
      timeout. Do not also call a bare `emitKeypressEvents`, which would lock in the 500 ms default. Then turn raw
      mode on, `input.resume()`, and hide the cursor (`\x1b[?25l`).
    - Keys: `enter` is mapped to `return`, and an `enter` right after a `return` is ignored. ctrl-c resolves the
      state with `result: 'quit'`.
    - Redraw on each key and on output `resize`: `\r`, move up `previous.length - 1` lines, `clearScreenDown`, then
      write.
    - Cleanup, on resolve or throw: remove listeners, close the interface if it isn't closed yet, `setRawMode(false)`,
      `input.pause()`, show the cursor (`\x1b[?25h`), then write a final newline.
  - `confirm(message, initial = true, io) -> Promise<boolean | null>`: built on `screen()`. The state is
    `{ yes: initial }`, rendered as one line `message  Yes / No` with the focused choice `inverse`. ←/→ toggle, `y`/`n`
    pick, enter confirms. ctrl-c gives `null`. The y/n keys reach `move` through the keypress `name`.
  - `line(message, io) -> Promise<string | null>`: `readline/promises` `question()`. ctrl-c closes the interface, and
    the resulting `AbortError` (or close) becomes `null`. Cleanup is the same as `screen`.
  - `note(title, lines)`: `frame(title, lines.flatMap((l) => wrap(l, inner)), { columns })` on `process.stdout`.
    `columns` is `process.stdout.columns ?? 80`.
  - `progress(label, fn) -> Promise<{ ok, err }>`: writes `label … `, then awaits `fn()`. A throw becomes
    `{ ok: false, err: e.message }`. Then it appends green `done`, or red `failed` with `  <err>` on the next line.
  - `log(kind, text)`: `'warn'` yellow, `'error'` red `✗ `-prefixed, `'info'` plain.
  - Module side effect: `process.on('exit')` and `SIGTERM`/`SIGHUP` handlers. If `process.stdin.isTTY` and it's still
    raw, they turn raw mode off and show the cursor; signals then exit with 128 + the signal number.

- [ ] **Step 1: Write the failing tests** with a fake TTY:

```js
const tty = () => {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(v) {
      this.isRaw = v;
    },
  });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 60, rows: 20 });
  return { input, output };
};
test('screen resolves on enter and restores the terminal', async () => {
  const io = tty();
  const done = screen(
    { n: 0 },
    {
      move: (s, k) => (k === 'down' ? { ...s, n: s.n + 1 } : k === 'return' ? { ...s, result: 'apply' } : s),
      render: (s) => [`n=${s.n}`],
    },
    io,
  );
  io.input.write('\x1b[B');
  io.input.write('\r');
  const s = await done;
  assert.deepEqual([s.n, s.result, io.input.isRaw, io.input.isPaused()], [1, 'apply', false, true]);
});
test('ctrl-c resolves quit; a throwing move still restores the terminal', async () => {
  /* \x03 → result 'quit'; move throws → rejects, isRaw false, output has \x1b[?25h */
});
test('confirm takes y/n and enter, ctrl-c is null', async () => {
  /* 'n' → false; '\r' with initial true → true; \x03 → null */
});
test('line returns the typed text, ctrl-c is null', async () => {
  /* 'clean\r' → 'clean'; '\x03' → null */
});
test('progress turns a throw into failed', async () => {
  /* fn throws Error('boom') → { ok: false, err: 'boom' } */
});
```

- [ ] **Step 2: Run** `node --test installer/ui.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `installer/ui.mjs`.
- [ ] **Step 4: Run** `node --test installer/ui.test.mjs`. Expected: all pass.
- [ ] **Step 5: Commit** `git add installer/ui.mjs installer/ui.test.mjs && git commit -m "Add the installer's zero-dependency terminal I/O."`

---

### Task 5: Wire `install.mjs`, add the update step

**Files:**

- Modify: `installer/install.mjs`: every `p.*` call; `dim` at `:40` and its uses at `:124`, `:412`, `:429-431`,
  `:512`, `:516`, `:521`; the chooser loop at `:419-447`; the plugin steps at `:487-495`.
- Delete: `installer/tabs.mjs`, `installer/tabs.test.mjs`.

**Interfaces:**

- Consumes: Tasks 1–4.

- [ ] **Step 1: Replace the UI calls** in `install.mjs`, one for one:
  - The local `step(doing, label, ...args)` (`:79`) is renamed `run(doing, label, ...args)`. It becomes
    `record(label, await progress(doing, () => claude(undefined, ...args)))`. Every caller is updated.
  - `p.intro` becomes a plain bold magenta line, `dead-claude-skills v<version>`.
  - `must(answer)` checks for `null` instead of `p.isCancel`. The two cancel messages stay.
  - `p.cancel(msg)` (`:47`, `:66`, `:351`, `:444`, `:464`) becomes `log('error', msg)`.
  - `ask` becomes `must(await confirm(message, initial))`.
  - The prep spinner becomes three `progress` lines: marketplace add, the official add, and reading plugins. A
    failed add exits 1, as today.
  - The brv and cswap spinners become `progress(label, () => downloadBrv(...))`, and likewise for cswap. The
    checksum-mismatch branch throws, so it reports as failed.
  - `p.note` becomes `note`.
  - `p.log.warn`, `.error` and `.step` become `log('warn' | 'error' | 'info', …)`.
  - `p.text` (the clean word) becomes `must(await line('Type "clean" to continue:'))`.
  - The summary becomes `note('Summary', …)`:
    - green `✓ <done>` lines;
    - red `✗ <failure>` lines, replacing the separate `p.log.error` loop;
    - then the autoUpdate and backup lines, as today.
  - `p.outro` becomes a final `log` line with today's words.
  - Delete `dim` and replace its uses with plain text.
  - Remove `import * as p` and the `chooseTabs` import.
- [ ] **Step 2: Build `data` and run the screens** in place of the chooser loop:
  - `rows`: normalise `listed` once, as `Array.isArray(listed) ? listed : listed.installed ?? []`, and use `rows`
    everywhere, including `installedIds`.
  - `shipped`: for each `manifest.plugins` entry with a string `source`, map its name to
    `readJson(join(PKG, source, '.claude-plugin', 'plugin.json')).version`.
  - `updates`: `outdated(rows, shipped)`.
  - `versions` and `disabled`: map each option key to the row with the same name. `disabled` marks keys whose row
    has `enabled === false`.
  - `tokens`: `tokenPlugins`.
  - `core`: `dead-skills + <n>, always installed`.
  - `describe`: `option()`.
  - `platform`: `` `${process.platform}-${process.arch}` ``.
  - Loop:
    - `state = await screen(state, { move: (s, k) => move(s, k, data), render: (s, o) => render(s, data, o) })`.
      ui passes `{ columns, rows }` from `output` as `o`.
    - On `'ask-quit'`: `confirm(\`Quit without applying ${n} changes?\`, false)`. Yes or `null`takes the quit path;
No re-enters with`result` cleared.
    - On `'quit'`: `Cancelled before installing anything.`, exit 0.
    - On `'apply'`: copy `state.chosen` into `chosen` and continue.
  - Delete `changes()` and the old review note.
- [ ] **Step 3: Add the update step** after the install/uninstall loops, before prune. For each
      `changeList(state, data).update` row, run
      ``run(`Updating ${nameOf(id)} ${from} → ${to}`, `updated ${id} ${from} → ${to}`, 'plugin', 'update', id, '--json')``.
- [ ] **Step 4: Delete** with `git rm installer/tabs.mjs installer/tabs.test.mjs`.
- [ ] **Step 5: Check for leftovers** with `grep -nE '\bp\.|\bdim\b|clack' installer/*.mjs`. Expected: no output.
- [ ] **Step 6: Run the tests** with `node --test installer/*.test.mjs`. Expected: all pass.
- [ ] **Step 7: Manual pty run**, with a fake `claude` and a scratch home, as in the previous feature's Task 4.
  - Set-up: the fake `claude` is a script on PATH. It answers `plugin list --json` with cswap 0.1.0, atlassian 0.1.0
    and graphify with a sha version, and logs every other call to a file.
  1. Run `HOME=$scratch CLAUDE_CONFIG_DIR=$scratch/.claude node installer/install.mjs` at 80×24.
  2. Walk start → Integrations → toggle mcp-azure → esc → Updates → skip graphify → esc → Apply → Back → esc.
     Expected: it asks whether to quit; answer Yes. The run exits 0, prints `Cancelled before installing anything.`,
     and the log has only `marketplace` and `list` calls.
  3. Repeat at 40 columns. Expected: the frame never wraps, and esc reacts without a visible delay.
  4. Run once through Apply. Expected: the log shows `plugin install mcp-azure@…` and
     `plugin update cswap@dead-claude-skills --json`.
  5. Press ctrl-c on the start screen and at the `Type "clean"` prompt. Expected: the terminal is usable afterwards
     (echo on, cursor visible).
- [ ] **Step 8: Real CLI check, once.** Run `claude plugin update cswap@dead-claude-skills --json` on a machine where
      `claude plugin list --json` shows cswap at an older version, after the installer has pinned the marketplace.
      Expected: `plugin list --json` then reports the shipped version. If it doesn't (it stays put or moves past the
      tag), stop: that is a deviation.
- [ ] **Step 9: Commit** with `git add -A installer && git commit -m "Rebuild the installer UI on Node's stdlib."`

---

### Task 6: Drop the dependencies and the shrinkwrap

**Files:**

- Modify: `package.json` (`dependencies`, `files`), `scripts/release.mjs:38-40`, `scripts/check-repo.mjs:49-50`,
  `flake.nix:57`, `README.md:31-36`
- Delete: `npm-shrinkwrap.json`

- [ ] **Step 1: Remove** `dependencies` and the `"npm-shrinkwrap.json"` entry in `files` from `package.json`. Then
      run `git rm npm-shrinkwrap.json`.
- [ ] **Step 2: Remove** the two `npm-shrinkwrap.json` bump entries in `release.mjs:38-40` (and the comment above
      the second one). Remove the lockfile read and check at `check-repo.mjs:49-50`. Drop `|npm-shrinkwrap` from the
      `flake.nix:57` regex, so it reads `(package)\\.json$`, or simplify it to `package\\.json$`.
- [ ] **Step 3: README**: rewrite the installer paragraph at `README.md:31-36` to describe the new flow:
  - the start screen, with one line per category;
  - enter opens a category;
  - the Updates line;
  - the review that lists only changes, with Apply / Back / Quit;
  - keys ↑/↓, enter and esc.

  Replace the clack/shrinkwrap sentence with: the installer has no npm dependencies.

- [ ] **Step 4: Run the checks**: `grep -rn 'shrinkwrap\|clack' package.json scripts flake.nix README.md installer`
      should give no output. Then run `node scripts/check-repo.mjs && node --test installer/*.test.mjs`. Expected: no
      problems, all tests pass.
- [ ] **Step 5: Commit** with `git add -A package.json scripts flake.nix README.md npm-shrinkwrap.json && git commit -m "Drop the installer's npm dependencies and the shrinkwrap."`

## Execution Handoff

Plan complete; execution method chosen at Gate 2.
