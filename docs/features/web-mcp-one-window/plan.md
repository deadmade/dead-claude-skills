# web-mcp one browser window: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each web-mcp server opens one visible Chrome window of its own the first time it needs a browser, keeps it
until it exits, and runs every search engine, `browser` session and fetch fallback as a tab in it.

**Architecture:**

- `crates/web-mcp/src/window.rs` keeps one **owner** agent-browser session per window. agent-browser launches Chrome
  for that session from a per-slot config. The window remembers the session's `get cdp-url` and its generation, and
  asks the owner again on each use: the owner relaunches a dead Chrome itself, and a new url starts a new generation.
- `Browser` (`browser.rs`) owns the `Window`. Every other agent-browser call attaches with `--cdp <url> --pin-tab`, so
  each session is a tab of that one Chrome.
- `profile.rs` holds the profile slot, the config files and the per-slot consent marks.
- `search.rs`, `tools.rs`, `fetch.rs` and `papers.rs` keep calling `Browser`.
- The installer warns when the window can't open on the machine.

**Tech Stack:**

- Rust 2024 (tokio, serde_json); `windows-sys` 0.61 (already in `Cargo.lock` through tokio) for the Windows job
  object.
- agent-browser 0.39.1, Chrome for Testing, I still don't care about cookies v1.1.9.
- The installer: TypeScript on Node 26, standard library only.

**Spec:** [spec.md](spec.md). Approved 2026-10-30; plan review reopened it (flow.md). ADR:
[0007](../../adr/0007-one-browser-window.md).

## Global Constraints

- **Seams:**
  - The window: its owner session, generation and cdp url. Resolved in `window.rs`, owned by `Browser`; never seen by
    `search.rs`, `tools.rs`, `fetch.rs` or `papers.rs`.
  - Which browser, extension and user agent, the profile slot, the engine rests and the consent marks: resolved in
    `profile.rs`; `window.rs` only receives its `Ready` and slot.
- **One window per web-mcp process.** It starts on the first call that needs a browser, never at startup, and lives
  until shutdown.
- **Never branded Chrome, never the user's profile.** Every agent-browser call passes `--config <file>`, has every
  `AGENT_BROWSER_*` variable removed, and runs with the search dir as its cwd.
  - The one exception: on attached calls web-mcp sets its own `AGENT_BROWSER_DEFAULT_TIMEOUT=8000`, a constant
    (`ENGINE_DEADLINE − READ_MARGIN`), because it is in agent-browser's daemon fingerprint.
  - A search's `wait` carries `--timeout <ms>` for its own deadline.
- **Calls:**
  - Owner calls: `--session <owner> --json --config profiles/<n>/agent-browser.json`, never `--cdp`.
  - Attached calls: `--session <s> --json --cdp <url> --pin-tab --config <search dir>/attach.json`.
  - **Closing an attached session** (deviation D-T1):
    - `tab close` with the attach flags, but only while its generation is current;
    - then `close` with the same env and `--config`, but without `--cdp` and `--pin-tab`.

    Only sessions this process has run are ever closed. A `close` on a session with no daemon starts one and leaks a
    tab (findings.md).
- **Session names:**
  - the owner: `web-mcp-<pid>-window`, the same in every generation;
  - engines: `web-mcp-<pid>-g<n>-search-<engine>`;
  - user sessions: `web-mcp-<pid>-g<n>-<name>`;
  - fetches: `web-mcp-fetch-<pid>-g<n>-<k>`.

  `n` starts at 1. `Browser` maps the caller's name to the current generation's at call time. `check_session` also
  reserves the name `window`.
- **Config files:**
  - The owner's is `profiles/<n>/agent-browser.json`, holding:
    - `profile`: `<slot>/profile`;
    - `extensions`: `[<ext>]`;
    - `executablePath`;
    - `userAgent`;
    - `headed`: `true`;
    - `args`: `--lang=en-US`, `--disable-background-timer-throttling` and `--disable-renderer-backgrounding`,
      newline-separated.

    It has no `idleTimeout`.
  - Attached calls use `<search dir>/attach.json`, holding `{"idleTimeout": "3600s"}`.
  - Paths must be UTF-8, else the config fails.
- **Chrome dies with web-mcp:**
  - Windows: web-mcp puts itself, best effort, in a `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` job at startup, through a
    handle that isn't inherited.
  - Linux: the first window start in a slot closes the owner named in `profiles/<n>/owner`, if it isn't ours. An owner
    with no daemon closes safely (findings.md).
- **A dead Chrome is found by the owner** (deviation D-T1):
  - `live()` runs the owner's `get cdp-url` before any deadline starts, and again after an attached call fails with
    anything other than `tab_gone`.
  - The owner relaunches a dead Chrome by itself, on a new port (findings.md). An answer that differs from the cached
    url starts the next generation.
  - When the generation changes, the old generation's sessions are closed in the background, and the failed call is
    retried once under its new name.
  - There is no TCP probe.
- **A window closed by hand** leaves Chrome running without a window. Its tabs answer `tab_gone`, and the `tab new`
  rebind opens a new window (findings.md).
- **A gone tab:** `tab_gone` is a typed error, read from the top-level `code` and from batch entries. It gets one
  `tab new` and one retry, for user calls and engine renders alike.
  - On `tab close`, `tab_gone` means already closed, and so does "Cannot close the last tab". `close` never retries.
- **Tabs:** engine tabs stay open and are reused. A failed engine render closes its tab.
- **Deadlines:** the window starts (`warm`) before any deadline clock: an engine's, papers' engines' and the fetch
  fallback's.
- **Slots and marks:**
  - Profile slots are `<search dir>/profiles/<n>/`, n = 1, 2, …, the first whose `lock` can be taken, held until
    exit.
  - `rest` stays at `<search dir>/<engine>/rest`. `consent-seen` moves to `profiles/<n>/<engine>/consent-seen`.
  - The old `<engine>/profile/` folders are left untouched.
- **What `browser` and the fetch fallback need:** without a search folder, a runnable non-branded browser or the
  extension, they fail with the same error `search` gives. This is accepted (D6).
- **Commits:** a commit message is one sentence, with no co-author lines. Stage named paths only, never `git add -u`
  or `-A`: GLOSSARY.md holds the user's uncommitted edits and is left for them to commit.
- If a task asks you to pass a new signal through types, schemas, pipelines, or similar layers, stop and look for a
  more direct path.

## Review Focus

1. **Several searches at once in one server:** both answer, and the second takes turns per engine. Pinned in Task 5
   (`concurrent_searches_in_one_server_both_answer`).
2. **The window goes away between two searches:**
   - Chrome died: the second search's `live()` sees a new cdp url, starts generation 2 before its deadline, and
     answers. Pinned in Task 4 (`changed_url_starts_next_generation`) and Task 5 (`dead_chrome_is_replaced`).
   - The window was closed by hand: every engine rebinds through `tab_gone`. Pinned in Task 5
     (`closed_window_rebinds_every_engine`).
3. **Two web-mcp servers at once:** they take slots 1 and 2. Pinned in Task 3 (`second_holder_gets_next_slot`) and
   Task 5 (`two_servers_take_two_slots`).
4. **The user closes one tab:**
   - an engine rebinds it on the next search (`engine_tab_is_rebound_once`);
   - a user session rebinds it once (`gone_tab_is_rebound_once`);
   - closing a gone tab opens none (`closing_a_gone_tab_opens_none`).

   All pinned in Task 5.
5. **The first search on a fresh machine:** starting the window takes 8 s, and every engine still answers. Pinned in
   Task 5 (`window_start_is_outside_the_engine_deadline`).

---

### Task 1: Spike: confirm the owner-session shape (throwaway)

No code is kept. Output: `docs/features/web-mcp-one-window/findings.md`. Each download goes into its own empty folder
in the session scratchpad.

**Files:**

- Create: `docs/features/web-mcp-one-window/findings.md`

**Interfaces:**

- Produces, for Tasks 2 to 5:
  - `EXTENSION_SHA256` and the zip's layout;
  - the exact JSON of `tab_gone` for a single call and for a batch entry;
  - the error a call gets after its Chrome died, saved as a fixture text in findings.md.

- [ ] **Step 1:** Get agent-browser 0.39.1 for win32-x64 from its release, check it against
      `installer/assets/agent-browser.json`'s sha256, and run `agent-browser install`.
- [ ] **Step 2:** Download
      `https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies/releases/download/v1.1.9/ISDCAC-chrome-source.zip`.
      Record its sha256, its layout (manifest at the root, or under one top folder), and that the unpacked folder
      loads.
- [ ] **Step 3:** Write the owner config as in Global Constraints. Run `--session own --config <it> open about:blank`,
      then `get cdp-url`. Record the url and that one window shows.
- [ ] **Step 4:** Run two attached sessions in parallel with `attach.json` and `AGENT_BROWSER_DEFAULT_TIMEOUT=8000`.
      Each runs a batch of `open` (Bing and DuckDuckGo result pages), `wait --fn … --timeout 3000` and
      `get html body`. Record:
  - that they overlap, each in its own tab;
  - that `wait --timeout 3000` bounds the wait.
- [ ] **Step 5:** Record, one line each:
  - after `tab close` and `close` of `a`, the owner and window stay;
  - closing `b`'s tab by hand, then a single call and a batch on `b`: the `tab_gone` JSON of each, and that `tab new`
    rebinds;
  - after the window is closed by hand, a call's error, and that a TCP connect to the url's port fails;
  - `close` on a session whose daemon is gone: does it start a daemon or a Chrome?
- [ ] **Step 6:** Bing with the extension: do results show? Google's consent page, from an EU IP if at hand: answered,
      hidden or left?
- [ ] **Step 7:** Windows job. A scratch harness puts itself in a kill-on-close job, starts the owner, and is killed
      hard. Do the daemon and Chrome go?
- [ ] **Step 8:** Any assumption that fails is a deviation: stop and report it. Clean up every daemon and Chrome.

### Task 2: Swap Consent-O-Matic for I still don't care about cookies

**Files:**

- Modify: `crates/web-mcp/src/profile.rs`:
  - the constants, `DOWNLOAD_MAX` and the "over 1 MiB" message at `:238`;
  - `unpack`, `extension`, and their tests.
- Modify: `crates/web-mcp/tests/common/mod.rs:216`
- Modify: `THIRD_PARTY.md:130`

**Interfaces:**

- Consumes: the sha256 and layout from Task 1.
- Produces:
  - `pub const EXTENSION_URL: &str` and `pub const EXTENSION_SHA256: &str`.
  - `unpack` writes `dir/idcac-<first 8 hex>`.
  - `Ready.extension` is that folder.

- [ ] **Step 1: Failing tests.**
  - `unpack_keeps_existing_version` with the `idcac-` name.
  - Only if Task 1 found a top folder: `unpack_strips_single_top_folder`.
- [ ] **Step 2:** They fail.
- [ ] **Step 3:** Implement:
  - `CONSENT_*` become `EXTENSION_*`.
  - `DOWNLOAD_MAX` is 2 MiB, and its message says "over 2 MiB".
  - The folder prefix is `idcac-`.
  - Messages say "the cookie extension".
  - `config`'s Bing exception stays until Task 5 deletes `config`.
- [ ] **Step 4:** Point the harness folder at `extensions/idcac-<8 hex>`. In THIRD_PARTY.md, replace Consent-O-Matic
      with I still don't care about cookies: GPL-3.0, its repo link, "downloaded at runtime, pinned v1.1.9 by sha256,
      not vendored".
- [ ] **Step 5:** In `crates/web-mcp`, `cargo test` and `cargo clippy --all-targets -- -D warnings` pass.
- [ ] **Step 6:** Commit the named files: "Replace Consent-O-Matic with I still don't care about cookies in web-mcp."

### Task 3: Profile slots, config files, engine turns and per-slot consent marks

**Files:**

- Modify: `crates/web-mcp/src/profile.rs`

**Interfaces:**

- Produces:
  - `fn try_lock_file(path: &Path) -> io::Result<Option<File>>`: the synchronous, non-blocking sibling of `lock_file`.
  - `pub fn slot(&self) -> Result<&Path, String>`: takes the first free `profiles/<n>` on first call, keeps the lock
    in a `OnceLock` until exit, and returns the same path afterwards.
  - `pub fn previous_owner(&self) -> Option<String>` and `pub fn set_owner(&self, session: &str)`, for
    `<slot>/owner`. Best effort.
  - `pub fn owner_config(&self, r: &Ready) -> Result<PathBuf, String>` writes `<slot>/agent-browser.json` (Global
    Constraints) with `utf8` and `write_if_changed`.
  - `pub fn attach_config(&self) -> Result<PathBuf, String>` writes `<dir>/attach.json`.
  - `pub async fn turn(&self, e: Engine, until: Instant) -> Option<tokio::sync::MutexGuard<'_, ()>>`: one mutex per
    engine.
  - `consent_seen` and `set_consent_seen` use `<slot>/<engine>/consent-seen` once a slot is held, and the old
    machine-wide path before that.
  - `pub fn dir(&self) -> &Path`.
  - `#[cfg(test)] pub fn with_chrome(self, chrome: PathBuf) -> Self`: `ready()` then uses that browser instead of
    `WEB_MCP_CHROME`, HOME and PATH. Tests seed `extensions/idcac-<8 hex>`, so nothing is downloaded.
  - Until Task 5 wires them in, the new items carry
    `#[cfg_attr(not(test), expect(dead_code, reason = "wired in Task 5"))]`.

- [ ] **Step 1: Failing tests:**
  - `first_free_slot_is_one`.
  - `second_holder_gets_next_slot`: slot 1 and slot 2; after dropping the first holder, the next gets slot 1.
  - `turn_waits_then_gives_up`.
  - `consent_mark_is_per_slot`.
  - `owner_round_trips`.
  - `owner_config_is_exact`: equals Global Constraints, with no `idleTimeout`.
  - `attach_config_is_exact`.
  - `non_utf8_paths_are_refused`: its `config` half moves to `owner_config`.
- [ ] **Step 2:** They fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cargo test` and clippy pass.
- [ ] **Step 5:** Commit: "Add profile slots, config files, engine turns and per-slot consent marks to web-mcp."

### Task 4: The window

**Files:**

- Create: `crates/web-mcp/src/window.rs`
- Modify: `crates/web-mcp/src/browser.rs`: add `pub(crate) async fn run_owner(&self, session: &str, config: &Path,
  args: &[String]) -> Result<Value, BrowserError>`. It is `run_with` without `--cdp`, with every `AGENT_BROWSER_*`
  removed, no default timeout, and the search dir as cwd. `run_with` gains the cwd as a parameter instead of taking
  it from the config's folder.
- Modify: `crates/web-mcp/src/main.rs`: `mod window;` and `window::tie_to_process()` first in `main`.
- Modify: `crates/web-mcp/Cargo.toml`, and `Cargo.lock`: under `[target.'cfg(windows)'.dependencies]`,
  `windows-sys = { version = "0.61", features = ["Win32_Foundation", "Win32_System_JobObjects", "Win32_System_Threading", "Win32_Security"] }`.
- Modify: `crates/web-mcp/tests/bin/fake_agent_browser.rs`:
  - It skips `--cdp <u>` (2) and `--pin-tab` (1).
  - `get cdp-url` answers `{"cdpUrl":"ws://127.0.0.1:9222/devtools/browser/<C>"}`, where `<C>` is the contents of
    `$FAKE_AB_STATE/chrome` (default `1`). A test changes that file to simulate Chrome relaunched on a new port.
  - With `FAKE_AB_OWNER_DELAY_MS`, an `open` on a session ending in `-window` sleeps that long first.

**Interfaces:**

- Consumes: `Profiles::{ready, slot, previous_owner, set_owner, owner_config, with_chrome}` (Tasks 2 and 3);
  `Browser::run_owner`.
- Produces:
  - `pub struct Window`, with `pub fn new(profiles: Result<Arc<Profiles>, String>) -> Self`.
  - `pub struct Live { pub gen: u32, pub url: String }`.
  - `pub async fn live(&self, b: &Browser) -> Result<Live, String>`, under a `tokio::sync::Mutex`:
    - **The first call:**
      1. `ready()`, then `slot()`;
      2. on Linux only, close `previous_owner()` if it isn't ours;
      3. write `owner_config` and `set_owner`;
      4. the owner's `open about:blank`, then `get cdp-url`;
      5. it answers gen 1.
    - **Later calls:** the owner's `get cdp-url`. The owner relaunches a dead Chrome by itself.
      - The same url answers the cached `Live`.
      - A different url answers gen + 1 with the new url.
      - An owner whose daemon died starts again from its config, so its answer gives the url too.
  - `pub fn owner(&self) -> String`: `web-mcp-<pid>-window`, for `close_all`.
  - `pub fn tie_to_process()`.

- [ ] **Step 1: Failing tests in `window.rs`.** They use the fake, `with_chrome` and a seeded extension.
  - `live_starts_once_for_parallel_callers`: one owner `open` is logged.
  - `same_url_keeps_the_generation`: a second `live` answers gen 1 and logs one more `get cdp-url`, and no `open`.
  - `changed_url_starts_next_generation`: after `$FAKE_AB_STATE/chrome` changes to `2`, `live` answers gen 2 with the
    new url.
  - `previous_owner_is_closed_first` (Linux only): with `profiles/1/owner` = `web-mcp-999999-window`, the first `live`
    logs a `close` on it before its own `open`.
  - `tie_to_process_kills_children` (Windows only): the test binary re-runs itself as a helper, ties itself, starts a
    sleeping child, and is killed hard. The child is gone within 2 s.
- [ ] **Step 2:** They fail.
- [ ] **Step 3:** Implement. `tie_to_process` logs one stderr line on failure and goes on.
- [ ] **Step 4:** `cargo test` and clippy pass. `Window` carries the `expect(dead_code)` until Task 5.
- [ ] **Step 5:** Commit `window.rs`, `browser.rs`, `main.rs`, `Cargo.toml`, `Cargo.lock` and the fake: "Add web-mcp's
      browser window, one owner session per server."

### Task 5: Every browser call goes through the window

**Files:**

- Modify: `crates/web-mcp/src/browser.rs`:
  - `Browser::new(name: &str, window: Window)`.
  - `run_with` gets the attach flags, the env and cwd, the generation retry and the `tab_gone` retry.
  - `BrowserError::TabGone`.
  - `warm`, `engine_session`, and the name mapping.
  - `close`, `close_all`, `render` and `rendered_html` change.
  - `SearchRun` loses `config` and `close_after`. `Isolated` goes.
  - The unit tests and `fake()` follow.
- Modify: `crates/web-mcp/src/main.rs`:
  - `Ctx.profiles: Result<Arc<Profiles>, String>`;
  - `browser_from`;
  - the comment at `:33`, which now says "then `search`, `browser` and the fetch fallback fail".
- Modify: `crates/web-mcp/src/search.rs:119-197,244-290`:
  - `run_engine` drops `r: &Ready`, `config` and `lock`, takes `profiles.turn`, and gets its session from
    `ctx.browser.engine_session(e)`.
  - `web` calls `ctx.browser.warm()` before the deadline, instead of `profiles.ready()`.
  - The doc comment loses the 23 s and the 120 s.
- Modify: `crates/web-mcp/src/papers.rs:640-665`: the engine branch calls `warm()`, then computes its deadline. The
  API sources don't wait for it. `browser_trouble_still_answers_from_apis` keeps its per-engine wording.
- Modify: `crates/web-mcp/src/fetch.rs`: the test `Ctx` at `:782` gets a temp search dir with `with_chrome` and a
  seeded extension. The `Browser::new` calls at `:737` and `:866` change.
- Modify: `crates/web-mcp/src/profile.rs`: delete `config`, `session`, `lock`, `EngineLock` and their tests. The Helium
  wrapper stays.
- Modify: `crates/web-mcp/src/engines/mod.rs:106-111,343-349`: delete `headed` and its assertion.
- Modify: `crates/web-mcp/src/tools.rs:381`: the description. The call site at `:171-172` keeps `session(&name)`,
  which now returns a key that `Browser` maps.
- Modify: `crates/web-mcp/tests/bin/fake_agent_browser.rs`:
  - Without `FAKE_AB_LOG`, it logs beside `--config`.
  - `$FAKE_AB_STATE/<session>.gone` makes a non-`tab` call, or that batch's `open` entry, answer Task 1's `tab_gone`
    JSON. `tab new` removes the marker.
  - `wait_fails` reads the `wait` command's `--timeout` instead of the env.
- Modify: `crates/web-mcp/tests/common/mod.rs`, `tests/browser.rs`, `tests/search.rs`, `tests/fetch.rs`,
  `tests/papers.rs`.

**Interfaces:**

- Consumes: `Window::{live, owner}` and `tie_to_process` (Task 4); `Profiles::{turn, attach_config}` and the marks
  (Task 3).
- Produces:
  - `pub async fn warm(&self) -> Result<(), BrowserError>`.
  - `pub fn engine_session(&self, e: Engine) -> String`: a key like the user ones, registered for `close_all`.
  - `pub fn session(&self, name: &str) -> String`: unchanged signature. It returns the key, and run, batch and close
    map it to the current generation's agent-browser name.

- [ ] **Step 1:** Update the fake and the harness (above).
- [ ] **Step 2: Failing and rewritten tests.**
  - **`tests/browser.rs`:**
    - `open_passes_session_json_and_limits`: `--cdp ws://127.0.0.1:9222/devtools/browser/1 --pin-tab`, and only
      `AGENT_BROWSER_DEFAULT_TIMEOUT=8000` in the env.
    - `two_sessions_stay_separate`: names `web-mcp-<pid>-g1-a` and `-g1-b`.
    - `opened_sessions_are_closed_on_shutdown_unless_closed`: per open session, `tab close` with `--cdp`, then
      `close` without `--cdp` and `--pin-tab`, then the owner's `close`.
    - `gone_tab_is_rebound_once`: `open`, `tab new`, `open`.
    - `closing_a_gone_tab_opens_none`.
    - `browser_starts_no_window_until_used`.
    - `app_shell_falls_back_to_browser`, `fallback_batch_has_no_output_limits`, `fallback_session_names_include_pid`
      (6 parts with `g1`) and `bad_scroll_is_rejected_and_split`: count calls and args after the owner's two.
    - `reserved_and_invalid_session_names_are_rejected` adds `window`.
  - **`tests/search.rs`:**
    - `search_fuses_all_four_engines`: one owner, four `-g1-search-<engine>` sessions.
    - `engine_tab_stays_between_searches`.
    - `engine_tab_is_rebound_once`.
    - `dead_chrome_is_replaced`: a search, then `$FAKE_AB_STATE/chrome` = `2` and `dead-g1` (calls of `-g1-` sessions
      answer findings.md's connect fixture), then a second search. It answers through `-g2-search-` sessions, and the
      log shows the `-g1-` sessions closed without `--cdp`.
    - `closed_window_rebinds_every_engine`: `.gone` markers on every engine session, then a search. Every engine logs
      `tab new` and answers.
    - `concurrent_searches_in_one_server_both_answer`: replaces `concurrent_searches_both_answer`.
    - `lock_won_late_starts_no_render`: rewritten for `turn` in one server.
    - `two_servers_take_two_slots`.
    - `window_start_is_outside_the_engine_deadline`: `FAKE_AB_OWNER_DELAY_MS=8000`.
    - `consent_clears_by_the_next_search` and `second_consent_counts_as_blocked`: the mark sits at
      `profiles/1/google/consent-seen`.
    - `render_scrubs_env_and_sets_cwd`: cwd is the search dir.
    - The `filters` comment at `:452` loses "Windows closes".
  - **`browser.rs` unit tests:**
    - `search_calls_drop_agent_browser_env`, `render_search_tolerates_failed_wait`, `render_closes_on_deadline` and
      `render_reads_a_page_that_never_gets_ready`: the attach config, the cwd, `wait --timeout`.
    - `check_session_reserves_search` adds `window`.
    - `close_waits_for_session_files`: rewritten around a failed render.
  - **Deleted:** `config_types_match_agent_browser_schema`, `bing_config_has_no_extension`,
    `lock_waits_then_gives_up`, `session_name_carries_dir_hash`, the headless half of
    `every_engine_waits_on_an_expression_and_runs_headless`, and the `close_after: true` case.
- [ ] **Step 3:** They fail.
- [ ] **Step 4:** Implement per Global Constraints. Remove the `expect(dead_code)` lines. The description reads:
      "Drive a tab of web-mcp's browser window through agent-browser. Each `session` is its own tab; close it when
      done.", followed by the rest unchanged.
- [ ] **Step 5:** In `crates/web-mcp`, `cargo test` and `cargo clippy --all-targets -- -D warnings` pass.
- [ ] **Step 6:** Commit: "Run every web-mcp browser call as a tab of its one window."

### Task 6: The installer warns when the window can't open

**Files:**

- Modify: `installer/core/binaries.ts`: `windowProblem`.
- Test: `installer/core/binaries.test.ts`.
- Modify: `installer/steps/agent-browser.ts`: `useAgentBrowser`, and the early returns of `installAgentBrowser`.

**Interfaces:**

- Produces: `export function windowProblem(o: { browserRuns: boolean; platform: NodeJS.Platform; display: boolean;
  xvfb: boolean }): string | undefined`.
  - `display` is `!!(env.DISPLAY || env.WAYLAND_DISPLAY)`. `xvfb` is `!!which('Xvfb')`.

- [ ] **Step 1: Failing tests in `binaries.test.ts`.** Each one's text matches exactly.
  - No browser:
    `"web-mcp's browser window can't open: no browser it can use. search, browser and the fetch fallback won't work until you run agent-browser install, or install Helium or Chromium."`
  - Linux, a browser, no display, no Xvfb:
    `"web-mcp's browser window can't open: this Linux has no display and no Xvfb. search, browser and the fetch fallback won't work until you install Xvfb or run Claude Code in a desktop session."`
  - Linux with a display, Linux with only Xvfb, and Windows without either: `undefined`.
- [ ] **Step 2:** `npm test` fails on them.
- [ ] **Step 3:** Implement.
  - On every path where web-mcp is selected, `steps/agent-browser.ts` computes it after the browser check:
    `log('warn', …)`, and `works` becomes `browserRuns && !problem`.
  - The early returns that skip the install (no agent-browser) still warn, with `browserRuns` from
    `searchBrowserWorks`, but return `works: false`, as before. (Deviation D-T6.)
- [ ] **Step 4:** `npm test` and `npm run typecheck` pass.
- [ ] **Step 5:** Commit the named files: "Warn in the installer when web-mcp's browser window can't open."

### Task 7: Docs and a live check

**Files:**

- Modify: `CLAUDE.md` (the web-mcp bullet)
- Modify: `plugins/shared/web-mcp/README.md`: line 17 and lines 40-55
- Modify: `README.md`, wherever the search browser is described (grep "Consent-O-Matic", "search browser",
  "window")
- Commit, already written: `docs/adr/0007-one-browser-window.md`, `docs/features/web-mcp-one-window/{flow,spec,plan,findings}.md`
- Modify: `docs/features/web-mcp-one-window/flow.md` (the live check)

- [ ] **Step 1:** Update CLAUDE.md:
  - One window per web-mcp, launched by an owner session on first use and kept until exit. Engines, `browser`
    sessions and fetches are tabs (`--cdp --pin-tab`).
  - Generations in attached session names; the owner relaunching a dead Chrome; a window closed by hand recovering
    through `tab_gone`; profile slots; per-slot consent marks.
  - I still don't care about cookies, for every engine.
  - The Windows job, and the installer's warning.
  - Drop the lines about closing after each search on Windows, one profile per engine and Consent-O-Matic.
- [ ] **Step 2:** In the plugin README and README.md, describe the same in plain words for a user, including what
      `browser` and the fetch fallback now need.
- [ ] **Step 3: Live check on this machine.**
  - Build `cargo build --release` and point a Claude Code session at it (`binPath`).
  - Run a `search`, a `browser open`, one more `search`, then close the window by hand and run one more `search`.
  - Exactly one Chrome window shows at a time, holding the engine tabs and the browsing tab, and it closes with the
    session.
  - Record the result in flow.md.
- [ ] **Step 4:** Commit the named files: "Describe web-mcp's one browser window in the docs."

### Task 8: Find Chrome for Testing on Windows without running it (deviation D-T7)

Found in Task 7's live check. On Windows `chrome.exe --version` opens a browser window instead of printing a version,
so `pick` (`crates/web-mcp/src/profile.rs`) never accepts Chrome for Testing there unless `WEB_MCP_CHROME` is set,
and every `--version` attempt flashes a Chrome window. The installer's `searchBrowserWorks`
(`installer/system/browser.ts`) does the same check.

**Files:**

- Modify: `crates/web-mcp/src/profile.rs`: `pick` and `version`, plus their tests.
- Modify: `installer/system/browser.ts`.
- Modify: `installer/system/browser.test.ts`.

**Interfaces:** unchanged. `pick` keeps its signature, and so does `searchBrowserWorks`.

**On Windows:**

- web-mcp never runs a browser binary with `--version`.
- Chrome for Testing counts as working when its binary exists (`newest_cft`), and its major comes from the folder name
  (`chrome-<a.b.c.d>`, already parsed).
- `WEB_MCP_CHROME`, `helium` and `chromium` take `FALLBACK_MAJOR`.
- The installer's `searchBrowserWorks` accepts a found Chrome for Testing binary without starting it.

**Elsewhere:** Linux is unchanged. `--version` there still checks that Chrome for Testing starts, because NixOS
downloads it but can't run it.

- [ ] **Step 1: Failing tests.**
  - `profile.rs`, Windows only: a seeded `chrome-<ver>\chrome.exe` that exits non-zero on `--version` is still picked,
    with the folder's major. A test hook should make "never run" observable: the seeded exe writes a marker file when
    it runs, and the test asserts the marker is absent.
  - `browser.test.ts`: on win32, a found Chrome for Testing binary counts as working without being started.
- [ ] **Step 2:** They fail.
- [ ] **Step 3:** Implement, with `cfg!(windows)` in Rust and `platform === 'win32'` in TypeScript.
- [ ] **Step 4:** `cargo test` and clippy in `crates/web-mcp`, then `node --test installer/system/browser.test.ts` and
      `npm run typecheck`.
- [ ] **Step 5:** Commit the named files: "Find Chrome for Testing on Windows without starting it."
