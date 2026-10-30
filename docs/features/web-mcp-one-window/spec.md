# web-mcp one browser window: spec

Status: draft, before the grill. _(user)_ marks the user's decisions, _(my call)_ marks mine.

## Problem

Every `search` flashes 4 to 6 Chrome windows on Windows, one per engine, and each closes again when its search ends.

Why:

- Each engine runs its own agent-browser session, with its own Chrome and its own profile.
- agent-browser treats a Chrome that loads an extension as headed
  ([chrome.rs#L380](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/cli/src/native/cdp/chrome.rs#L380-L390)),
  and on Windows a headed Chrome runs on the visible desktop
  ([windows_process.rs#L90](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/cli/src/native/cdp/windows_process.rs#L90-L141)).
- Every engine Chrome loads Consent-O-Matic, so every one is a window.

The user doesn't mind seeing a window: engines reject them anyway. The problem is the number of windows. One window is
also easier to manage, and Claude sessions had trouble navigating among several.

## Goal

**One browser window per web-mcp process.** _(user)_

- It opens on the first call that needs a browser: `search`, the `browser` tool or the fetch fallback. Never at
  startup. _(user: "only start it with the first request")_
- It stays open until web-mcp shuts down, then closes. _(user)_
- Everything web-mcp does in a browser runs as a **tab** of that window. _(user: "one window for both")_
  - Every engine of a search.
  - Every `browser` tool session.
  - Every fetch fallback.
- Several Claude Code sessions mean one window each, never one shared window. _(user)_
- Searches stay as fast as today: engines still run in parallel, each in its own tab. _(user picked A)_

## Non-goals

- **No hidden or headless window.** The window is a normal, visible Chrome window.
- **No window shared across web-mcp processes.**
- **No change to engines, parsing, ranking, the `.web/` archive or the rest rule** (a blocked engine rests 30 min).

## Design

### The window

- An **owner session** launches the window: one agent-browser session per window, `web-mcp-<pid>-g<n>-window`.
  _(plan review D1: B)_
  - agent-browser launches the Chrome under the config web-mcp writes for it.
  - The browser is the same as today, picked by `pick`: `WEB_MCP_CHROME`, the newest Chrome for Testing, Helium,
    Chromium. Never branded Chrome.
  - The profile is the slot's `profile/`.
  - The extension is I still don't care about cookies.
  - The user agent is the regular one web-mcp already builds, without `HeadlessChrome`.
  - The args are `--lang=en-US`, `--disable-background-timer-throttling` and `--disable-renderer-backgrounding`.
    Every tab but the one you look at is in the background, so throttling would stall them; Playwright and
    browser-use pass both flags. _(my call)_
  - The owner session has no `idleTimeout`, so the window stays.
- Every other session attaches with `--cdp <url> --pin-tab`, where the url is the owner's `get cdp-url`
  ([README#L760](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/README.md#L760-L781)).
  - `--pin-tab` binds each session to a fresh tab of its own.
  - Sessions run in parallel, because each one is its own daemon.
  - Attached sessions get `"idleTimeout": "3600s"`, so a daemon left behind exits within an hour. _(user: "set it
    to an hour")_
- **Lifetime:**
  - At shutdown web-mcp closes the attached sessions, then the owner session, which closes Chrome.
  - **If the user closes the window,** Chrome keeps running without one. The next call gets `tab_gone`, rebinds with
    `tab new`, and that opens a new window. _(spike, deviation D-T1: A)_
  - **If Chrome dies,** the owner session relaunches it on a new port by itself. web-mcp sees the new `get cdp-url`
    and starts a new generation `g<n+1>`, which goes into every attached session's name, so no session still points
    at the dead Chrome. The old sessions are closed in the background. _(plan review D2: A; D-T1: A)_
  - The window starts before an engine's or the fetch fallback's deadline clock, so a first search that downloads
    the extension and starts Chrome still gets its full 10 s per engine. _(plan review D3)_
- **Isolation:** unchanged, except for what the user gave up.
  - It is never the user's Chrome or profile.
  - Every `AGENT_BROWSER_*` variable is still dropped, so the user's agent-browser settings never reach it.
  - Search tabs and browsing tabs share one profile now. Pages Claude opens can set cookies that later searches see.
    _(user: "i dont care about cookies")_ This reverses ADR 0004's "pages Claude opens can't change the search
    profile".

### Profile slots

- Profiles live at `<search dir>/profiles/<n>/`, for n = 1, 2, 3… _(user: "just reuse")_
- A web-mcp process holds the first free slot under a file lock until it exits. A slot whose lock is free is free,
  even when it was used before. Its cookies and history carry over.
- The slot is taken lazily, together with the window.
- _(my call)_ The per-engine rest (`<engine>/rest`) stays machine-wide, so one session's block rests that engine for
  every session.
- The per-engine lock goes: an engine no longer owns a profile. Inside one process, an engine's searches take turns
  on that engine's tab, guarded by an in-process lock.

### Tabs

- **Engine tabs:** one tab per engine, opened on that engine's first search and reused afterwards. _(my call: "uses
  it from there on")_
  - The tab stays put, so a later search doesn't open a fresh one and the engine sees the same browser again.
  - A tab that fails (an error or the deadline) is closed. The next search opens a new one.
- **`browser` tool sessions:** each user-named session is one tab, and `close` closes that tab, not a browser. The
  tool's description changes from "Each `session` is its own browser" to a tab.
- **Fetch fallback:** a tab of its own, closed again after the render.

### The cookie extension

- [I still don't care about cookies](https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies) replaces
  Consent-O-Matic. _(user)_
  - GPL-3.0, release v1.1.9, asset `ISDCAC-chrome-source.zip` (540 KB).
  - Like Consent-O-Matic today, it is downloaded on first use, pinned by sha256, unpacked whole or not at all, and not
    vendored. THIRD_PARTY.md names it.
- It is on for every tab, Bing included: a single Chrome can't load an extension for some tabs and not others.
  - **Unverified:** Consent-O-Matic broke Bing's result page (findings R7). The first build task checks Bing with the
    new extension.
  - If it breaks Bing, that is a deviation and goes to the user.
- The two-step consent rule stays: a consent page met twice in a row rests the engine. Its "met once" mark now lives
  per profile slot (`profiles/<n>/<engine>/consent-seen`), because each slot has its own cookies. Rests stay
  machine-wide. _(plan review D4)_

### What goes

- `close_after` and closing engine sessions after each search on Windows.
- `Engine::headed`.
- The per-engine config files. One owner config per slot and one attach config per server replace them.
- The per-engine `profile/` folders. They become unused. _(my call: web-mcp leaves them on disk, and no migration
  copies their cookies)_
- Consent-O-Matic's download and pin.

### To verify in the build, before the code depends on it

The plan review read these in agent-browser 0.39.1's source:

- `close` on a `--cdp` session only disconnects; it never closes the tab. So web-mcp runs `tab close` first.
- `--config <file>` keeps `~/.agent-browser/config.json` and a project's `agent-browser.json` out.

The build's first task checks the rest on this machine:

1. The owner session's `get cdp-url` answers for a headed session with an extension.
2. Several sessions attached with `--cdp <url> --pin-tab` run in parallel, each in its own tab.
3. The owner stays up while attached sessions open and close.
4. Reusing a closed session's name answers `tab_gone`, and `tab new` rebinds it.
5. Bing works with I still don't care about cookies loaded.

## Grill decisions (2026-10-30, the user accepted every recommendation)

- **Seams:**
  - The window: its owner session, generation and cdp url. Resolved in `window.rs`, owned by `Browser`; never seen
    by `search.rs`, `tools.rs` or `fetch.rs`.
  - Which browser, extension and user agent, the profile slot, the engine rests and the consent marks: resolved in
    `profile.rs`; `window.rs` only receives its `Ready` and slot.
- **Chrome dies with web-mcp:**
  - On Windows, web-mcp puts itself in a kill-on-close job at startup. Its agent-browser daemons, and the Chrome
    agent-browser starts in its own job, go when web-mcp goes, however it goes.
  - On Linux, a hard-killed web-mcp leaves its owner session and Chrome running. The next web-mcp that takes that
    slot first closes the owner session recorded in `profiles/<n>/owner`. _(plan review D1)_
- **A closed window or tab is reopened** on the next call that needs it. Nothing errors.
- **Engine tabs stay open and are reused**, so a window holds up to 4 engine tabs, 6 with papers.
- **Linux behaves the same as Windows:** one visible window.
- **The old per-engine `profile/` folders are left on disk untouched.** Slots start fresh, with no migration.
- **ADR 0005** records the shared window and the end of search/browsing profile isolation.

## What the other tools now need

_(plan review D6: A)_

- The `browser` tool and the fetch fallback share the window, so they now need what `search` needs: a search folder, a
  non-branded browser and the cookie extension.
- They always open a visible window. On Linux without a display, that works only with Xvfb installed, which
  agent-browser starts by itself.
- The README and `main.rs` say so.
- The installer warns when web-mcp is selected and the window can't open there: no non-branded browser runs, or Linux
  has no `DISPLAY`/`WAYLAND_DISPLAY` and no `Xvfb` on PATH. _(user: "give a warning in the installer when none are
  there")_
- That case also counts as unhealthy, so the built-in web tools stay allowed.

## Docs to change

- The CLAUDE.md web-mcp bullet: windows, profiles and the extension.
- README.md and the web-mcp plugin README, wherever they describe search browsers.
- THIRD_PARTY.md: the extension.
- GLOSSARY.md: Session, Search profile and the new terms.
- A new ADR that supersedes the isolation consequence in ADR 0004.
