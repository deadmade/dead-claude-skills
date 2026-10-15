# Turn-done notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in `notify` plugin that pops a desktop notification when a turn ends or Claude waits for the user,
on Linux, Windows and (best effort) macOS, skipped while the user looks at that session.

**Architecture:** A plain `hooks/hooks.json` runs `hooks/notify.mjs` (a three-line entry calling `main()`) async on
`Stop` and `Notification`. All logic lives in `hooks/lib.mjs`: pure exported decisions with a `node:test` file, and
`main`, which reads the hook JSON from stdin and spawns the platform notifier (busctl → notify-send, an inline
PowerShell WinRT toast, osascript). The installer's `mergeSettings` turns Claude Code's built-in notification off
while the plugin is selected.

**Tech Stack:** Node ≥20.12 stdlib (`node:child_process`, `node:test`), Windows PowerShell 5.1, systemd `busctl`.

**Spec:** `docs/superpowers/specs/2026-10-15-turn-notifications-design.md`

## Global Constraints

- No npm dependencies; Node's standard library only.
- Version `0.2.0` in `plugins/notify/.claude-plugin/plugin.json` (`check-repo.mjs` fails on drift). Never bump by hand.
- Hooks run `async: true`; never block or fail the turn. Every error is swallowed (exit 0).
- Claude's text never reaches a shell or a script source: argv elements (`spawn` without `shell`) or environment
  variables only.
- Opt-in: not in `plugins/dead-skills` `dependencies`.
- Commit messages are one sentence, no co-author lines.

## Review Focus

1. Claude's answer contains quotes, `$()`, `<b>`, `&`, newlines or emoji → shown literally on every platform,
   nothing executed, toast XML valid. (Task 1 `truncation`, Task 2 `windows passes text by env`, `linux escapes`.)
2. `last_assistant_message` empty or missing (tool-only turn) → body is just the status line. (Task 1.)
3. tmux without `focus-events on`, or tmux failing → treated as not focused → notify. (Task 1, Task 2.)
4. Notifier binary missing (no busctl, no notify-send, no PowerShell) → silent, exit 0. (Task 2 `main exits 0`.)
5. `settings.json` missing or invalid JSON → plain wording, no crash. (Task 1.)

---

### Task 0: Record what the installed Claude Code sends (no code)

- [ ] **Step 1:** In `$TMPDIR`, write a settings file with `Stop` and `Notification` (no matcher) command hooks
      that append `$CLAUDE_CODE_ENTRYPOINT` and stdin to `$TMPDIR/hooklog`. Run it with `claude --settings <file>`:
      `-p "say ok"`; once interactively, triggering a permission prompt, an AskUserQuestion, and a subagent (Task tool)
      turn; and `claude plugin test` in `plugins/cswap` if it fires hooks.
- [ ] **Step 2:** Record in `docs/features/turn-notifications/flow.md` under Grounding: the entrypoint value per run
      kind; the Stop fields (`last_assistant_message`, `stop_hook_active`, `cwd`, `agent_id` when in a subagent); the
      Notification fields (`message`, `notification_type`) and which `notification_type` each wait raises; whether
      `agent_needs_input` fires a second event for the same wait. Decide the matcher from it, starting from
      `permission_prompt|elicitation_dialog` (add `agent_needs_input` only if it has no twin).
- [ ] **Step 3:** If any value differs from Tasks 1–2 below, fix those tasks' tests in the plan before starting
      Task 1 (that is a deviation: log it).

### Task 1: Decisions: what to say and whether to say it

**Files:**

- Create: `plugins/notify/.claude-plugin/plugin.json` (name `notify`, version `0.2.0`, description, author and
  repository as `plugins/night-city/.claude-plugin/plugin.json`, no `types`)
- Create: `plugins/notify/hooks/lib.mjs`
- Test: `plugins/notify/hooks/lib.test.mjs`
- Modify: `package.json` `test`: add `"plugins/notify/hooks/*.test.mjs"` to the `node --test` globs
- Modify: `flake.nix:43` (installer-test hook command: same glob) and `flake.nix:71` (its `files` regex: add
  `plugins/notify/hooks/`)
- Modify: `.claude-plugin/marketplace.json`: entry after night-city: `name: notify`, `source: ./plugins/notify`,
  `category: development`, description `"Desktop notifications when a turn ends or Claude needs you, on Linux,
Windows and macOS; quiet while you're looking at the session. Opt-in."`
- Modify: `installer/core.mjs:385` system page: add `'notify'` to keys; blurb `'Status line, sandbox, command
guard, notifications and the Night City theme.'` (the test at `installer/core.test.mjs:376-383` requires every
  marketplace plugin on a page)
- Modify: `CLAUDE.md` Checks line for `npm test` (also runs `plugins/notify/hooks/*.test.mjs`)

**Interfaces (all exported from `lib.mjs`):**

- `DONE: string[]`, `WAITING: string[]`
- `shouldNotify(input, env) -> boolean`: false when `input.stop_hook_active`, when `input.agent_id` is set, or when
  `env.CLAUDE_CODE_ENTRYPOINT` starts with `sdk` (values per Task 0).
- `tmuxFocused(output: string) -> boolean`: output of the tmux call in Task 2: first line `#{pane_active}#{window_active}`,
  then one `#{client_flags}` line per client of the session. True only when the first line is `11` and any later
  line has `focused` as a comma-separated item.
- `nightCityEnabled(settingsText: string | undefined) -> boolean`: `enabledPlugins['night-city@dead-claude-skills']
=== true`; false on undefined or invalid JSON.
- `message(input, { nightCity: boolean, pick: (list: string[]) => string }) -> { title: string, body: string }`:
  raw text, no escaping.

- [ ] **Step 1: Write the failing tests** (`node:test` + `node:assert/strict`, like `installer/core.test.mjs`):
  - `skips continuations, subagents and headless runs`: `shouldNotify({stop_hook_active:true}, {})` false;
    `({agent_id:'a1'}, {})` false; `({}, {CLAUDE_CODE_ENTRYPOINT:'sdk-cli'})`, `'sdk-ts'`, `'sdk-py'` false;
    `({}, {CLAUDE_CODE_ENTRYPOINT:'cli'})` true; `({}, {})` true.
  - `tmux focus needs active pane, active window and a focused client`: `'11\nattached,UTF-8\nattached,focused'`
    true; `'11\nattached,UTF-8'` false; `'01\nfocused'` false; `'10\nfocused'` false; `''` false;
    `'11\nunfocused'` false.
  - `night-city is on only when enabled in settings`: `'{"enabledPlugins":{"night-city@dead-claude-skills":true}}'`
    true; same with `false` → false; `undefined` false; `'{oops'` false.
  - `plain stop message`: `message({hook_event_name:'Stop', cwd:'/home/u/dead-claude-skills',
last_assistant_message:'\nAll tests pass.\nDetails'}, {nightCity:false, pick:(l)=>l[0]})` deep-equals
    `{title:'Claude Code · dead-claude-skills', body:'Done\nAll tests pass.'}`.
  - `plain waiting message`: `{hook_event_name:'Notification', message:'Claude needs your permission to use Bash'}`
    → body `'Needs your input\nClaude needs your permission to use Bash'`.
  - `question message`: `{hook_event_name:'PreToolUse', tool_name:'AskUserQuestion', tool_input:{questions:[{question:'Which DB?'}]}}`
    → body `'Needs your input\nWhich DB?'`; with `tool_input:{}` → `'Needs your input'`.
  - `night-city wording`: with `nightCity:true, pick:(l)=>l[0]` the first body line is `DONE[0]` for Stop and
    `WAITING[0]` for Notification and PreToolUse.
  - `empty answer gives the status line alone`: Stop without `last_assistant_message` → `'Done'`; with `'\n\n'` →
    `'Done'`.
  - `truncation keeps whole characters`: a 300-char first line → second body line is 120 code points, ending `…`;
    a line with `😀` at code point 119 → the result contains no lone surrogate
    (`!/[\uD800-\uDFFF]/.test(s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))`).
- [ ] **Step 2: Run** `node --test plugins/notify/hooks/lib.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the exports. Title uses `path.basename(input.cwd ?? process.cwd())`. Truncate with
      `[...line]` (code points). Word lists (new lines, none from night-city's `words.ts`):
  - `DONE`: `Come look at your Agent`, `Gig's done, choom`, `Eddies are in your account`, `Run complete. ICE is
clean`, `Your fixer left a message`, `Job's wrapped. Jack back in`, `Braindance is ready to play`, `Delta's
done. Back to you`.
  - `WAITING`: `Songbird requests your help`, `Incoming call on your Agent`, `Your fixer's on the holo`, `Need your
eyes on this, choom`, `Netrunner awaits your authorization`, `The daemon won't move without you`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git add plugins/notify package.json flake.nix .claude-plugin/marketplace.json
installer/core.mjs CLAUDE.md && git commit -m "Add the notify plugin's message and focus decisions."`

### Task 2: Delivery: hooks.json, notifiers, icon

**Files:**

- Create: `plugins/notify/hooks/hooks.json`, `plugins/notify/hooks/notify.mjs`, `plugins/notify/icon.png`
- Modify: `plugins/notify/hooks/lib.mjs`, `plugins/notify/hooks/lib.test.mjs`

**Interfaces:**

- Consumes: Task 1's exports.
- Produces (exported from `lib.mjs`):
  - `notifiers(platform: string, msg: {title, body}, icon: string) -> Array<{ argv: string[], env?: object }>`:
    commands to try in order; empty for an unknown platform.
  - `TMUX_ARGV(pane: string) -> string[]`: `['tmux','display-message','-p','-t',pane,'#{pane_active}#{window_active}',
';','list-clients','-t',pane,'-F','#{client_flags}']`.
  - `main({ stdin: string, env, platform }) -> Promise<void>`; never rejects.

- [ ] **Step 1: Write the failing tests:**
  - `linux tries busctl then notify-send and escapes markup`: `notifiers('linux', {title:'T', body:'a <b> & c'},
'/p/icon.png')` → two entries; `[0].argv` deep-equals `['busctl','--user','call','org.freedesktop.Notifications',
'/org/freedesktop/Notifications','org.freedesktop.Notifications','Notify','susssasa{sv}i','Claude Code','0',
'/p/icon.png','T','a &lt;b&gt; &amp; c','0','0','-1']`; `[1].argv` deep-equals `['notify-send','-a','Claude
Code','-i','/p/icon.png','T','a &lt;b&gt; &amp; c']`.
  - `windows passes text by env, never in the script`: `notifiers('win32', {title:'$(x)', body:'"; rm <b>'},
'C:\\Users\\A B\\icon.png')` → one entry; `argv` starts `['powershell','-NoProfile','-NonInteractive',
'-WindowStyle','Hidden','-Command']`; no argv element contains `$(x)` or `rm`; `env.NOTIFY_TITLE === '$(x)'`,
    `env.NOTIFY_BODY === '"; rm <b>'` (raw; the script escapes), `env.NOTIFY_ICON === 'C:\\Users\\A B\\icon.png'`;
    `env.PATH === process.env.PATH` (the full environment is merged in).
  - `mac passes raw text as argv`: one entry, `argv` is `['osascript','-e', <fixed script>, 'T', 'a <b> & c']`.
  - `unknown platform gives nothing`: `notifiers('aix', …)` deep-equals `[]`.
  - `main exits quietly on bad input`: spawn `node plugins/notify/hooks/notify.mjs` with stdin `'not json'` and with
    `'{}'` plus `env: {...process.env, PATH: ''}`; both exit code 0 within 10 s.
- [ ] **Step 2: Run** `node --test plugins/notify/hooks/lib.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement:**
  - `notifiers` as tested. Escape only on Linux (`&`, `<`, `>`). The Windows `-Command` script is a constant: load
    `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]`
    and `[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]`;
    `Add-Type` `user32` `GetForegroundWindow` + `GetWindowThreadProcessId`; exit if the foreground process is
    `WindowsTerminal`; build `ToastGeneric` XML from `[Security.SecurityElement]::Escape($env:NOTIFY_TITLE/BODY)`
    and `<image placement="appLogoOverride" src="…">` with `([Uri]$env:NOTIFY_ICON).AbsoluteUri` (escaped); show it
    with `CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe')`.
    macOS script: `on run argv` → `display notification (item 2 of argv) with title (item 1 of argv)`.
  - `main`: parse stdin (bad JSON → return); `shouldNotify` or return; when not win32 and `env.TMUX_PANE` is set,
    run `TMUX_ARGV` and return if `tmuxFocused(stdout)`; any tmux error counts as not focused. Read `settings.json`
    from `env.CLAUDE_CONFIG_DIR` or `~/.claude`; build the message; spawn each `notifiers(...)` entry in turn until
    one doesn't fail with `ENOENT`. Icon path: `path.join(<plugin root from import.meta.dirname>, 'icon.png')`.
  - `notify.mjs`: read all of stdin, `await main({stdin, env: process.env, platform: process.platform})`.
  - `hooks.json`: `Stop` (no matcher), `Notification` (matcher `permission_prompt|elicitation_dialog`, per Task 0)
    and `PreToolUse` (matcher `AskUserQuestion`; deviation, see flow.md), each one command hook
    `node "${CLAUDE_PLUGIN_ROOT}/hooks/notify.mjs"` with `"async": true`.
  - `icon.png`: 256×256, a neon glyph in night-city's palette (`plugins/night-city/themes/night-city.json`). Only
    the PNG is committed.
- [ ] **Step 4: Run** `npm test` and `claude plugin validate plugins/notify`. Expected: PASS.
- [ ] **Step 5: Smoke test here:** `echo '{"hook_event_name":"Stop","cwd":"'$PWD'","last_assistant_message":"hi <b>&</b> 😀"}' | env -u TMUX_PANE node plugins/notify/hooks/notify.mjs`.
      Expected: a noctalia popup with the icon, title `Claude Code · dead-claude-skills`, body `Done` / `hi <b>&</b> 😀`
      shown literally. With `focus-events on` and `TMUX_PANE` kept, from the focused pane: no popup; from an unfocused
      pane (`sleep 3; …` then switch): popup.
- [ ] **Step 6: Commit** `git add plugins/notify && git commit -m "Deliver notify's popups via D-Bus, a Windows
toast or osascript."`

### Task 3: Installer toggle and docs

**Files:**

- Modify: `installer/core.mjs:113` `mergeSettings` (new option `notify`), `installer/install.mjs:583-584`
- Test: `installer/core.test.mjs` (next to the nightCity tests, ~:513)
- Create: `plugins/notify/README.md`
- Modify: `README.md` (plugin list), `CLAUDE.md` (Layout: one line on `plugins/notify/`)

**Interfaces:**

- Produces: `mergeSettings(settings, { …, notify: boolean })`.

- [ ] **Step 1: Write the failing test** `notify turns the built-in notification off, and deselecting restores it`:
      `mergeSettings({}, {notify:true}).preferredNotifChannel === 'notifications_disabled'`;
      `mergeSettings({preferredNotifChannel:'notifications_disabled'}, {notify:false}).preferredNotifChannel ===
undefined`; `({preferredNotifChannel:'kitty'}, {notify:false})` keeps `'kitty'`; `({preferredNotifChannel:'kitty'},
{notify:true})` gives `'notifications_disabled'`.
- [ ] **Step 2: Run** `node --test installer/core.test.mjs`. Expected: the new test FAILS.
- [ ] **Step 3: Implement** beside the nightCity block: a one-line why comment, a `shortcut:` comment like the
      syntax-highlighting one (deselecting clears a `notifications_disabled` the user set themselves), and a comment that
      retiring notify from the marketplace leaves the setting behind. In `install.mjs` pass
      `notify: selected.some((id) => nameOf(id) === 'notify')`.
- [ ] **Step 4: Write `plugins/notify/README.md`:** what fires (Stop, the matched Notification types); when it stays
      quiet (focused tmux pane with `focus-events on`, any attached client counts; Windows Terminal in front;
      continuations; subagents; headless runs); delivery and requirements per platform (Linux: `busctl` or `notify-send`
      and a notification daemon; Windows PowerShell 5.1; macOS best effort, no icon); night-city wording; install note:
      the installer sets `preferredNotifChannel: "notifications_disabled"`, installing or uninstalling via `/plugin`
      means setting or removing it by hand. Add the plugin to the root README's list and the CLAUDE.md Layout.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `git add installer README.md CLAUDE.md plugins/notify/README.md && git commit -m "Offer
notify in the installer and turn the built-in notification off with it."`

### Task 4: Manual check on Windows (user)

- [ ] **Step 1:** On Windows native in Windows Terminal, install from the branch, finish a turn with another app in
      front: a toast with the icon appears. With Windows Terminal in front: none. Record in flow.md. If silent, check
      Focus Assist and that Windows PowerShell has notifications on in Windows Settings.
