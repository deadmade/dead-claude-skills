---
flow: feature
phase: execute
---

# web-mcp one search window: flow

## Request

> Hey, would it be possible to adjust the web-mcp so it works in just one window? So it opens its own window and uses
> it from there on? so no 4-5 windows that closes?

## Artifacts

- Spec: [spec.md](spec.md)
- Plan: [plan.md](plan.md)
- ADRs: [0007-one-browser-window.md](../../adr/0007-one-browser-window.md)
- Glossary: GLOSSARY.md (Browser window, Session, Profile slot replaces Search profile)

## Gates

- Gate 1, spec approved: 2026-10-30 ("I approve"). Reopened 2026-10-30: plan review D1 and D5 change the spec's
  Chrome-ownership seam, the "Chrome dies with web-mcp" mechanism and `idleTimeout`; D4 changes where `consent-seen`
  lives.
- Gate 2, plan approved: 2026-10-30 ("Approve, subagent-driven"). Execution: subagent-driven. The reopened spec
  items (D1, D4, D5, D6) were re-approved with it.

## Skipped

## Grounding

- `search` runs Google, Bing, DuckDuckGo and Brave in parallel (`crates/web-mcp/src/search.rs:127` `run_engine`), each
  in its own agent-browser session and Chrome with its own profile (`profile.rs:251` `config`, `profile.rs:277`
  `session`): 4 Chromes per search, 6 for papers.
- Every engine is headless (`engines/mod.rs:108` `headed` is `false`), but on Windows agent-browser puts a browser
  with extensions on the visible desktop, so each engine's Chrome shows a window. web-mcp closes each one right after
  its search there (`search.rs:158` `close_after: cfg!(windows)`, `browser.rs:353`), so every search flashes 4-5
  windows. On Linux they stay warm 120 s (`idleTimeout`) and are invisible.
- Why one profile per engine (spec of web-mcp-search, Isolation, D1): Chrome can't open one profile twice, the engines
  run in parallel, and one Chrome can't be headless for some engines and headed for others. Bing runs without
  Consent-O-Matic, which breaks Bing's result page (findings R7, `profile.rs:253`).
- After a `close`, the next `open` on that session must wait for the `.pid`/`.sock` files to go (`browser.rs:381`).
- Domain docs: `GLOSSARY.md` (Engine, Search profile, Session), ADR 0004 (browser search). GLOSSARY.md has the
  user's uncommitted writing-style edits: don't clobber them.

## Brainstorm notes

- User, on "never see anything vs one window you can see": "they show because search engines are dicks and reject
  me". A visible window is fine (engines reject a hidden/headless one); what bothers them is the 4-5 that flash.
  Goal: one visible search window, reused.
- Lifetime: "window stays open for as long as web-mcp runs (i havew no problem with the window) I have a problem that
  they are so many and I thought it would be way easier to just manage one and also navigating on it some claude
  sessions had issus with it".
- Profiles: "just reuse" (reused profile slots, first free one).

- Scope: "I thought about using one window for both. And could we just use i dont care about cookies?" The search
  and the `browser` tool share the one window. The cookie extension becomes I still don't care about cookies.
  - [Its repo](https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies), fetched 2026-10-30: a GPL-3.0 fork of
    "I don't care about cookies", whose original "has been acquired by Avast".
  - [Its latest release](https://api.github.com/repos/OhMyGuus/I-Still-Dont-Care-About-Cookies/releases/latest):
    v1.1.9 (2025-12-07), one asset, `ISDCAC-chrome-source.zip`, 540 KB.

## Prior art

Background agent, 2026-10-30. Every source was fetched in that run; the downloads are in the session scratchpad.

- **Why the windows show:** agent-browser 0.39.1 counts a session as headless only when it loads no extensions.
  - [chrome.rs#L380-L390](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/cli/src/native/cdp/chrome.rs#L380-L390):
    `effectively_headless()` is `headless && extensions empty`, because content scripts don't run under
    `--headless=new`.
  - [windows_process.rs#L90-L141](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/cli/src/native/cdp/windows_process.rs#L90-L141):
    on Windows a headless Chrome runs on a private desktop, a headed one on the visible desktop.
  - So every engine that loads Consent-O-Matic is a visible window on Windows, whatever `headed` says.
- **Launch args:** user `args` reach Chrome unfiltered
  ([chrome.rs#L446-L573](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/cli/src/native/cdp/chrome.rs#L446-L462)).
- **Tabs:**
  - `tab new`, `tab <n|label>`, `tab list` and `tab close` exist
    ([commands.rs#L1566](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/cli/src/commands.rs#L1566-L1613)),
    but they switch the active tab, and a session runs one command at a time
    ([daemon.rs#L584](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/cli/src/native/daemon.rs#L584-L591)).
  - Parallel tabs need several sessions sharing one Chrome over `--cdp <port> --pin-tab`
    ([README#L760-L781](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/README.md#L760-L781)).
  - agent-browser treats a Chrome reached over `--cdp` as externally owned, so web-mcp must launch it and kill it
    ([README#L1433](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/README.md#L1433)).
- **Idle timeout:** an explicit `idleTimeout` works on Windows
  ([daemon.rs#L431-L472](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/cli/src/native/daemon.rs#L431-L472)).
- **Background tabs get throttled:**
  - Playwright ([chromiumSwitches.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts#L61-L80))
    and browser-use ([profile.py](https://github.com/browser-use/browser-use/blob/main/browser_use/browser/profile.py))
    both pass `--disable-background-timer-throttling` and `--disable-renderer-backgrounding`.
  - agent-browser passes only `--disable-backgrounding-occluded-windows`.
- **One profile, one browser:** Playwright MCP's README says a persistent profile can be used by one browser at a time
  ([README](https://github.com/microsoft/playwright-mcp/blob/main/README.md)).
- **Shared browser versus one per job:** puppeteer-cluster offers both
  ([README](https://raw.githubusercontent.com/thomasdondorf/puppeteer-cluster/master/README.md)).
  - `CONCURRENCY_PAGE` gives each job a page of one shared browser, so jobs share cookies.
  - `CONCURRENCY_BROWSER` gives each job its own browser, so one crash doesn't take the others down.
- **Approaches found:**
  - **A:** one Chrome that web-mcp launches, engines as pinned tabs, one session per engine over `--cdp`.
  - **B:** keep a Chrome per engine, but off-screen and warm.
  - **C:** force `--headless=new` with the extension. Unclear whether content scripts run.
  - **D:** one session, engines run one after another in tabs.

## Options

- **How it is built** (2026-10-30). The user picked A: "A pls".
  - Offered:
    - A: web-mcp owns one Chrome, and every engine and `browser` session gets its own tab over `--cdp --pin-tab`
      (recommended).
    - B: one window, everything run one after another.
    - Smallest: off-screen, warm Chromes per engine.
  - B was rejected because it is about 4× slower and a search waits while Claude browses. The smallest option was
    rejected because it isn't one window.
- **Several Claude sessions** (2026-10-30). The user picked one window per session: "one window per session pls. But
  only start it with the first request".
  - Offered: one window shared machine-wide (recommended), or one window per web-mcp process.
  - The window starts lazily, on the first `search`, `browser` or fetch-fallback call, never at startup.

## Plan review

Round 1, 2026-10-30.

- Reviewers: Correctness (fable), Fit (opus), Simpler (sonnet). 32 findings, duplicates merged, none dropped.
- The user's answer: "1B, 2A, 3 yes, keep, 5. lets rmeove idleTimeout pls or set it to an hour!"
- **D1, who launches Chrome:** B.
  - An owner agent-browser session, `web-mcp-<pid>-g<n>-window`, launches the window with the slot's profile and the
    extension. Every other session attaches with `--cdp <get cdp-url> --pin-tab`.
  - On Windows, web-mcp puts itself in a kill-on-close job. On Linux, the next holder of a slot closes the previous
    owner session recorded in it.
  - This deletes web-mcp's own launcher, `prctl`, fake-chrome and port polling.
  - Raised by: Simpler 1-3, Fit 5 and 15, Correctness 4, 5 and 7.
- **D2, restart:** A. A generation counter goes in every session name, and old sessions are closed in the background.
  - Raised by: Correctness 1 and 8, Fit 8.
- **D3, deadline:** yes. The window is started before an engine's or the fetch fallback's deadline clock.
  - Raised by: Fit 6, Correctness 9.
- **D4, consent-seen:** "keep". Read as the recommendation: per profile slot, with rests staying machine-wide.
  - Raised by: Fit 12.
- **D5, idle daemons:** attached sessions get `"idleTimeout": "3600s"`, per the user's "set it to an hour". The owner
  session gets none.
  - Raised by: Fit 9, Correctness 2.
- **Mechanical fixes, taken without objection:**
  - `papers.rs` and the `fetch.rs` and `browser.rs` unit tests go into Task 5. (Fit 1, 2, 10)
  - Half-built code doesn't fail clippy. (Fit 3)
  - Only named paths are staged. (Fit 11)
  - `tab close` and `close` are not retried on `tab_gone`. (Correctness 3)
  - The wait timeout goes per command (`wait --timeout`), not in the env. (Correctness 6)
  - The concurrency tests run inside one server. (Fit 7)
  - The Helium wrapper stays. (Fit 4)
  - The missed doc strings get fixed. (Fit 14)
  - The engine-session interface is named. (Fit 13)

Round 2, 2026-10-30. The plan's shape changed in round 1, so the review was re-run.

- Reviewers: Correctness (fable), Fit (opus). 22 findings, duplicates merged, none dropped.
- The correctness reviewer confirmed in agent-browser 0.39.1's source:
  - the owner daemon never idles out;
  - `get cdp-url` works as `--cdp`;
  - daemons stay in web-mcp's job (no `CREATE_BREAKAWAY_FROM_JOB`);
  - an attached daemon never closes the shared Chrome;
  - pinned sessions never adopt the owner's tab.
- **Folded in as fixes:**
  - **Gone tabs:** `tab_gone` is caught as a top-level `code` and in batch entries, with a typed error. Engine renders
    rebind with `tab new`. (C1)
  - **Timeouts:** `wait --timeout` per command, plus one constant `AGENT_BROWSER_DEFAULT_TIMEOUT=8000` set by
    web-mcp on attached calls. (C2, F9)
  - **Liveness:** `warm()` probes the window over TCP before any deadline. Papers and the fetch fallback warm first,
    and death is decided by the probe, not by error text. (C3, C4, F10)
  - **Old generations:** the old owner is closed before the next generation starts, and `close_all` closes old
    owners. (C4b, C8)
  - **Tests:** a test seam for `ready`, and `profile.rs` writes the owner config. (F1, F3b, F4)
  - **The owner's calls** don't attach. (F2)
  - **Generations stay inside `Browser`:** `failed` returns the old owner, and `Browser` maps user names to the
    current generation. (F5, F6)
  - **Lists:** test lists, an owner delay in the fake, `Cargo.lock`, and the files missing from the tasks. (F3, F7, F8)
  - **ADR 0007** is rewritten for the owner-session design and committed in Task 6. GLOSSARY.md is left for the user
    to commit. (F11)
  - **Smaller items:** a sync `try_lock_file`; a dead previous owner's `close` is skipped when its socket is gone;
    `tie_to_process` is best effort. (F13, F14, C5, C6)
- **D6, what `browser` and the fetch fallback need:** A, accept and document it. The user: "Accept that and give a
  warning in the installer when none are there!"
  - The installer warns when web-mcp is selected and no non-branded browser runs, or when Linux has no display (no
    `DISPLAY`/`WAYLAND_DISPLAY`) and no `Xvfb` on PATH.
  - Either case also counts as not healthy for the web-builtins toggle. (F12)

## Tasks

The build runs in worktree `.claude/worktrees/web-mcp-one-window`, branch `worktree-web-mcp-one-window`, from
origin/main d1428c6.

- Task 1: base d1428c6. Untracked at start: `docs/features/web-mcp-one-window/` and
  `docs/adr/0007-one-browser-window.md`.
  - Result: `findings.md` written. That is a file the task listed, so the files are clean. It led to deviation D-T1.
- Task 2: base d1428c6. Untracked at start: the same, plus `findings.md`. Commit f5ebd63 touches `profile.rs`,
  `tests/common/mod.rs` and `THIRD_PARTY.md`, all on the task's list, so the files are clean. The review was clean.
- Task 3: base f5ebd63. Untracked at start: the same as Task 2's. Commit ad4f3b1 touches only `profile.rs`, so the
  files are clean. The review was clean. Two Minors go to Task 5: take the slot through `warm` before any consent
  read, and fix two stale doc comments.
- Task 4: base ad4f3b1. Untracked at start: the same. Commit 5e2b1c5 touches `window.rs`, `browser.rs`, `main.rs`,
  `Cargo.toml`, `Cargo.lock` and the fake, all on the task's list, so the files are clean. The review was clean;
  minor hygiene notes are parked in the ledger.
- Task 5: base 5e2b1c5. Untracked at start: the same. Commit c80d227 touches 13 files, all on the task's list
  (`window.rs` was added to it by D-T5), so the files are clean.
  - Review: one Important, the generation retry was untested. Fix round 1 added `dead_chrome_is_replaced_mid_call`
    (ba5b9d8, `tests/browser.rs` only), and the re-review marked it ADDRESSED.
  - 6 minors are deferred to the final review.
- Task 6: base ba5b9d8. Untracked at start: the same. Commit a3ce791 touches `core/binaries.ts`,
  `core/binaries.test.ts` and `steps/agent-browser.ts`, so the files are clean. The review found a plan-mandated
  Important, which went to the user as D-T6; fix a5e009e.
- Task 7: base a5e009e. Untracked at start: the same. Commit e3b040f (docs, ADR, feature docs). Its live check found
  D-T7.
- Task 8: base e3b040f. Commit d09fd2e touches `profile.rs`, `installer/system/browser.ts` and its test, so
  the files are clean. The review was clean.
- Final review (whole branch, d1428c6..8525c2a): "With fixes". No Critical. The one Important (GLOSSARY.md never
  updated) was already done in the main checkout's uncommitted GLOSSARY.md, which the user commits. The doc Minors,
  the `shortcut:` comment and the deferred minors' triage were applied in 51d2c96, which also renumbers the ADR to
  0007 (0005 was taken by `0005-agent-limits-and-models.md`, which the review missed). The rest it judged fine to
  leave.

## Rulings

- 2026-10-30, pre-flight: the spike uses agent-browser 0.39.4, origin/main's pin, not 0.39.1 — that is the version
  users get — if its behaviour differs from 0.39.1's source, the spike's deviation stop catches it.
- 2026-10-30, Task 1: implementers return their report inline instead of writing a file — this harness refuses
  subagent report files — none.
- 2026-10-30, Task 2: the machine had no Rust toolchain — the user chose "Install rustup", so stable is installed with
  rustup, checked against the official sha256 — none.
- 2026-10-30, Task 3: the plan's `expect(dead_code)` attributes are dropped — rustc 1.99.1 doesn't lint unused `pub`
  items in a binary crate, so the expectations are unfulfilled and `-D warnings` fails — none; Task 5 has nothing to
  remove.
- 2026-10-30, Task 3: `cargo fmt` whitespace in Task 2's lines, and an extra test, `with_chrome_is_the_browser`, are
  kept — both are inside the task's file — none.
- 2026-10-30, Task 4: `Window`, `Live`, `impl Window` and `run_owner` carry
  `cfg_attr(not(test), expect(dead_code))` — rustc does warn for these, unlike Task 3's items — none; Task 5 removes
  them.
- 2026-10-30, Task 4: `owner_config` is written before the previous owner's `close` — that `close` needs the config
  file to exist — none.
- 2026-10-30, Task 4: the owner's cwd comes from `config.ancestors().nth(3)` (the search dir) — it keeps the brief's
  `run_owner` signature — if the folder layout changes, the cwd is wrong.
- 2026-10-30, Task 5: Task 5 may touch `window.rs`, only to remove Task 4's `expect(dead_code)` lines — they must go
  once the items are used — none.
- 2026-10-30, Task 5: `opened` records the agent-browser names that actually ran, with their generation.
  `session()` and `engine_session()` return keys that are mapped at call time — closing a session that never ran
  leaks a tab (findings.md) — none.
- 2026-10-30, Task 5: a user `close` of a session this process never ran answers success without calling
  agent-browser — same reason — none.
- 2026-10-30, Task 5: `longest_session_name_stays_short` checks the first attached call — `calls[0]` is now the
  owner's call — none.
- 2026-10-30, Task 5: in the fake, `dead-g<n>` fails only calls that pass `--cdp` — matches findings.md — none.
- 2026-10-30, Task 5: the integration tests get a fresh `FAKE_AB_STATE` dir from `Mcp::start_with` — it avoids a clash
  with the harness's `chrome` dummy — none.
- 2026-10-30, Task 5: papers' `warm()` loses the `papers_deadline` timeout — the plan says warm, then the deadline —
  a stuck owner call blocks papers' engines for up to 60 s (the call timeout).
- 2026-10-30, Task 1: the spike gets no code review — it has no code, and the user ruled on its findings through
  D-T1 — none.
- 2026-10-30, Task 6: the fix's re-review was the controller reading the 12-line diff — a trivial mechanical fix —
  one missed regression, which the final review would catch.
- 2026-10-30, final review: its GLOSSARY.md Important needs no fix on the branch — the terms are already in the main
  checkout's uncommitted GLOSSARY.md, which the user commits — none.
- 2026-10-30, final review: the controller applied the fix wave itself and re-reviewed it, with no fix subagent — 22
  lines of doc text, one comment and a `cargo fmt` pass; `cargo test` and clippy are green — a wording slip in the docs.
- 2026-10-30, final review: the ADR is renumbered 0005 → 0007 — 0005 was already `0005-agent-limits-and-models.md`
  (#85), and CLAUDE.md cites ADR 0005 for flows' agents — none.
- 2026-10-30, final review: a rebound tab answers with no note that its page was lost (review Minor 3) — the spec says
  nothing errors — a Claude session may be puzzled by an empty snapshot.

## Deviations

### D-T1: The spike contradicts four of the plan's assumptions (2026-10-30)

Details are in [findings.md](findings.md).

**What the spike found:**

1. **Closing the window by hand doesn't end Chrome.** The port stays up, sessions get `tab_gone`, and `tab new`
   opens a new window.
2. **`close` with `--cdp` fails once Chrome has died.** It works without `--cdp` and `--pin-tab`.
3. **`close` on an attached session with no daemon starts one,** and leaks a tab.
4. **The owner session relaunches a dead Chrome by itself, on a new port.** On Windows, the TCP probe sees the
   refusal only after about 2 s.

**Options:**

- **A (recommended):**
  - Liveness comes from the owner's `get cdp-url`, which relaunches a dead Chrome itself. A changed url means a new
    generation. The TCP probe goes.
  - A window closed by hand is handled by the `tab_gone` → `tab new` path, which opens a new window.
  - Every `close` of an attached session runs without `--cdp` and `--pin-tab`. A live tab gets `tab close` (with
    `--cdp`) first.
  - Only sessions this process has run get closed.
- **B:** keep the probe and add a `/json/list` "no pages" check. That is an extra outside call, and it still needs the
  close fix.
- **C:** kill daemons by their `.pid` after a failed close. That is OS-specific, and the files stay behind anyway.

**The user's decision**, 2026-10-30 (AskUserQuestion): "A: owner cdp-url (Recommended)".

**What changed in the plan:**

- The owner's name is fixed: `web-mcp-<pid>-window`. The generation only goes into attached sessions' names.
- `live()` asks the owner for `get cdp-url`. A new url starts the next generation. The TCP probe and the
  closing of old owners go.
- Closes run without `--cdp` and `--pin-tab`.
- The `.sock` check for a previous owner goes, since closing an owner that has no daemon is safe.

### D-T5: `Browser` can't reach `attach.json` (2026-10-30)

**What:** every attached call needs `--config <search dir>/attach.json`, with the search dir as its cwd. But
`Browser::new(name, window)` gets no `Profiles`, and `Window`'s `profiles` field is private. No interface the plan names
lets `browser.rs` get the attach config.

**Options:**

- **A (recommended):** add `Window::attach_config() -> Result<PathBuf, String>`, delegating to `Profiles`. "How do I
  attach to you" belongs to the window's seam. It is about 4 lines in `window.rs`.
- **B:** add a `Window::profiles()` accessor. `Browser` then reaches into `profile.rs` itself.
- **C:** change the signature to `Browser::new(name, window, profiles)`.
- **D:** derive the search dir in `Browser` from the owner config's path. That duplicates the layout, so it is not
  recommended.

**The user's decision**, 2026-10-30 (AskUserQuestion): "A: Window::attach_config".

### D-T6: the installer reports web-mcp healthy without agent-browser (2026-10-30)

**What:** in Task 6, the plan had the three early returns of `installAgentBrowser` (bad pin, declined download, failed
download) compute `works` from `searchBrowserWorks`. With any browser present, the installer then turns off Claude's
built-in web tools, although web-mcp can't search without agent-browser.

**Options:**

- **A (recommended):** keep `works: false` on those returns, and still print the window warning.
- **B:** leave it as built.

**The user's decision**, 2026-10-30 (AskUserQuestion): "Keep false, still warn (Recommended)". This amends the plan's
Task 6 Step 3. `window.rs` joins Task 5's file
list for it.

### D-T7: Chrome for Testing is never found on Windows (2026-10-30, found in Task 7's live check)

**What:** `pick` accepts Chrome for Testing only if `chrome.exe --version` answers within 5 s. On Windows that command
opens a browser window instead of printing a version. So without `WEB_MCP_CHROME`, web-mcp finds no browser on
Windows, and every attempt flashes a Chrome window. The installer has the same check. The bug predates this branch
(#71).

**Options:**

- **Fix it here as Task 8 (recommended).**
- **Fix it in a separate follow-up.**

**The user's decision**, 2026-10-30 (AskUserQuestion): "Fix here as Task 8 (Recommended)". Task 8 is added to the
plan.

## Live check

2026-10-30, Windows 11, the release build driven over stdio JSON-RPC (no Claude Code session), agent-browser 0.39.4,
Chrome for Testing 156, a fresh search folder and project. Windows counted as visible top-level Chrome for Testing
windows, tabs from CDP `/json/list`.

- **Without `WEB_MCP_CHROME`:** every call answered "no browser for search" after 5 s. `pick` accepts Chrome for
  Testing only if `chrome.exe --version` exits, and on Windows it opens a browser instead of printing (still running
  after 8 s; the installer's `searchBrowserWorks` makes the same check). Older than this branch (#71), not fixed here.
  The rest ran with `WEB_MCP_CHROME` set to that Chrome for Testing.
- `search` "rust tokio mutex" → 1 window; tabs bing, brave, about:blank, newtab; answered yes (bing; google and
  duckduckgo timed out on the cold start, brave an EOF from its daemon). 18.9 s, extension downloaded.
- `browser open` example.com, session `s` → 1 window; example.com added as a tab; answered yes, 0.5 s.
- `search` "rust serde untagged enum" → 1 window; 7 tabs (engines, google's sorry page, example.com); answered yes
  (duckduckgo, brave; google captcha, bing unrecognised page).
- Window closed by WM_CLOSE → 0 windows. Chrome exited altogether (no chrome.exe left, port refused), rather than
  running on without a window as in findings.md; 6 agent-browser daemons stayed.
- `search` "python asyncio taskgroup" → 1 window again (the owner relaunched Chrome, next generation; the old
  daemons were closed: 6 → 3); answered yes (duckduckgo, brave; google resting from the captcha, bing timed out).
- `browser snapshot` in `s` → 1 window; `s` rebound to a fresh tab (about:blank: its page went with the dead Chrome).
- stdin closed → web-mcp exited in 5.1 s; 1 s later no chrome.exe, agent-browser.exe or web-mcp.exe was left.

## Walkthrough

Paths are under `crates/web-mcp/` unless they start with `installer/`.

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
| One window per web-mcp process | 4, 5 | `src/window.rs:58` (`live`), `src/browser.rs:276` (`warm`) | `window.rs:206` `live_starts_once_for_parallel_callers` |
| Opens on the first call that needs a browser, never at startup | 4, 5 | `src/browser.rs:276`, `src/search.rs:265`, `src/papers.rs:647`, `src/browser.rs:631` | `tests/browser.rs:252` `browser_starts_no_window_until_used` |
| Stays open until shutdown, then closes | 4, 5 | `src/main.rs:70` (`close_all`), `src/browser.rs:430`, `src/window.rs:110` (`tie_to_process`, `main.rs:41`) | `tests/browser.rs:126` `opened_sessions_are_closed_on_shutdown_unless_closed`, `window.rs:281` `tie_to_process_kills_children` |
| Every engine is a tab | 5 | `src/browser.rs:268` (`engine_session`), `src/browser.rs:339` (`attached`) | `tests/search.rs:128` `search_fuses_all_four_engines`, `:221` `engine_tab_stays_between_searches` |
| Every `browser` session is a tab | 5 | `src/browser.rs:156` (`name`), `src/browser.rs:339` | `tests/browser.rs:162` `gone_tab_is_rebound_once` |
| Every fetch fallback is a tab | 5 | `src/browser.rs:631` | `tests/browser.rs:340` `parallel_fallbacks_use_separate_sessions`, `:559` `slow_fallback_still_closes_its_session` |
| One window per Claude Code session, never shared | 3 | `src/profile.rs:164` (`slot`) | `tests/search.rs:309` `two_servers_take_two_slots` |
| Searches stay as fast: engines in parallel, each in its own tab | 5 | `src/search.rs:265` (warm before the deadline) | `tests/search.rs:328` `window_start_is_outside_the_engine_deadline` |
| A closed window or dead Chrome recovers | 4, 5 | `src/window.rs:58`, `src/browser.rs:304` (`retire`), `:339` | `tests/search.rs:252` `dead_chrome_is_replaced`, `:289` `closed_window_rebinds_every_engine`, `tests/browser.rs:187` `dead_chrome_is_replaced_mid_call`, `window.rs:244` `changed_url_starts_next_generation` |
| I still don't care about cookies for every engine | 2 | `src/profile.rs:21`, `:324` | `profile.rs:681` `bad_extension_hash_is_refused`, `tests/search.rs:378` `consent_clears_by_the_next_search` |
| Installer warns when the window can't open | 6 | `installer/core/binaries.ts:107` (`windowProblem`), `installer/steps/agent-browser.ts` (`windowWorks`) | `installer/core/binaries.test.ts:156` |
| Chrome for Testing is found on Windows (D-T7) | 8 | `src/profile.rs` (`version`, `pick`), `installer/system/browser.ts` | `installer/system/browser.test.ts`, profile.rs's `pick` tests |

No goal is without code, and no code is without a goal: the docs (Task 7) and the spike (Task 1) carry no goal of
their own.

## Run verdict
