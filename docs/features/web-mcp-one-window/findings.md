# web-mcp one window: spike findings

Task 1's throwaway spike, run 2026-10-30.

- **Setup:** Windows 11, agent-browser 0.39.4 (win32-x64, the pinned version), and Chrome for Testing 156.0.8078.80
  from `agent-browser install`.
- **Every call** ran with `AGENT_BROWSER_*` removed, with `--config <file>`, and with the search dir as cwd.
- **Attached calls** also had `AGENT_BROWSER_DEFAULT_TIMEOUT=8000`.

## Downloads

- **agent-browser:** `agent-browser-win32-x64.exe` v0.39.4, sha256
  `be19a109a004f84c367d7913c22b8046390b3e0e5241f9f6c7e83c7bacd22aae`. It matches `installer/assets/agent-browser.json`.
- **The extension zip:** `ISDCAC-chrome-source.zip` v1.1.9, 539792 bytes, `EXTENSION_SHA256`
  `8f70ab947cb2d274f4022a970f5dd3cecd8ec02b060e05187bef9ee3cb18bbcb`.
- **Its layout:**
  - `manifest.json` sits at the root, with no top folder.
  - Beside it: `manifest_v2.json`, `manifest_v3.json`, `_locales/`, `data/`, `icons/`, `rules.json` and `LICENSE`.
  - It is MV3, version `1.1.9`, with the service worker `data/background.js`.
- **The unpacked folder loads:** CDP lists
  `service_worker chrome-extension://abjihcefmboknbneijpdkelagonfbmpe/data/background.js`.

## Owner

- **Launch:** `--session own --json --config profiles/1/agent-browser.json open about:blank` launched one headed
  window. It is one Chrome process tree, whose parent is the daemon.
- **Its cdp url:** `get cdp-url` gave `{"cdpUrl":"ws://127.0.0.1:33853/devtools/browser/9a0d2f21-…"}`.
- **Chrome's command line** carried:
  - `--user-data-dir=<slot>/profile`, `--remote-debugging-port=0`;
  - `--load-extension=<ext>` and `--disable-extensions-except=<ext>`;
  - `--lang=en-US`, `--disable-background-timer-throttling` and `--disable-renderer-backgrounding`.
- **A startup tab:** the window also holds a `chrome://newtab/` tab beside the owner's `about:blank`.
- **The owner is not pinned:** after other sessions opened tabs, the owner's `get url` returned `b`'s DuckDuckGo url.
  It follows the active tab.

## Attached sessions

- **They run in parallel:**
  - `a` (Bing) and `b` (DuckDuckGo) started their batches in the same millisecond. `a` ended after 2141 ms and `b`
    after 4700 ms.
  - Each got its own targetId.
  - Every page was in one window: `Browser.getWindowForTarget` gave the same windowId.
- **`wait --timeout` works**, even though it is below the 8 s default:
  - `wait --fn false --timeout 3000` in a batch ended at 3 s.
  - Its entry was `{"command":["wait","--fn","false","--timeout","3000"],"error":"Wait timed out after 3000ms","result":null,"success":false}`,
    with no `code`.
  - The batch went on (`get html body` ran) and exited 1.
- **Closing `a`:**
  - `tab close` answered `{"success":true,"data":{"closed":true,…,"tabId":"t2","targetId":"46C7…"}}`.
  - `close` answered `{"success":true,"data":{"closed":true,…}}`.
  - The owner, the window and the other tabs stayed. `a`'s daemon exited.
- **`close` on a live attached session only disconnects:** session `e` opened example.com, `close` succeeded, and its
  tab stayed open.

## tab_gone

The tab was closed from outside, through CDP `Target.closeTarget`.

- **A single call** (`get url`, and also `open` and `tab close`) exits 1 with:
  `{"success":false,"data":{"lastUrl":"https://html.duckduckgo.com/html/","targetId":"1286B38370EA2D730F17516A9B3639FD"},"error":"tab_gone: bound tab is gone (target 1286B38370EA2D730F17516A9B3639FD, last url https://html.duckduckgo.com/html/). Run `agent-browser tab new <url>` to bind a new tab, or `agent-browser tab list` to pick an existing one","code":"tab_gone"}`
- **A batch** fails every entry the same way, and exits 1:
  `{"code":"tab_gone","command":["get","url"],"error":"tab_gone: bound tab is gone (…same text…)","result":{"lastUrl":"https://html.duckduckgo.com/html/","targetId":"1286B38370EA2D730F17516A9B3639FD"},"success":false}`
- **`tab new` rebinds:** it answered `{"success":true,"data":{…,"tabId":"t4","targetId":"DE8D…","total":2,"url":"about:blank"}}`,
  and the next `open` ran in that tab.
- **`tab close` on a gone tab** returns the same single-call `tab_gone` JSON.
- **Not tested:** "Cannot close the last tab".

## Window closed by hand

The window got WM_CLOSE through `CloseMainWindow`.

- **Chrome didn't exit.** The browser process stayed, with no window and no pages, only the extension's service
  worker. A TCP connect to the cdp port still succeeded.
- **Afterwards:**
  - `b` got `tab_gone`.
  - The owner's `get url` succeeded, with `about:blank`, a new page.
  - A new attached session's `open` and `b`'s `tab new` both succeeded.
  - All three pages were in one new window.

## Chrome died

The browser process was killed.

- **The port:** a TCP connect is refused, but Windows reports it only after about 2 s
  (`fail after 2079 ms: … actively refused it`). A 500 ms probe therefore ends by timeout.
- **The fixture**, the same for a single call and a batch (a batch returns this object, not an array), exit 1:
  `{"error":"CDP WebSocket connect failed: IO error: No connection could be made because the target machine actively refused it. (os error 10061)","success":false}`
  - A new attached session's `open` returns the same fixture.
- **The owner relaunches Chrome silently** on its next call. Its `get url` succeeded, with a new Chrome pid and a new
  cdp url (`ws://127.0.0.1:65089/…`), while `lifecycle` said `"relaunchedBrowser":false`.
- **`close` of an attached session:**
  - with `--cdp <dead url>`, it returns the fixture and leaves its daemon running;
  - with the same env and config but without `--cdp` and `--pin-tab`, it succeeds, the daemon exits, and no Chrome
    starts;
  - without `--cdp` and without `AGENT_BROWSER_DEFAULT_TIMEOUT`, the daemon also ends, reporting
    `"restartedBackground":true`.
- **The owner's `close`** closed its Chrome, and its daemon exited.

## close on a session whose daemon is gone

- **The owner** (no `--cdp`): success, with no Chrome and no daemon left.
- **An attached session, Chrome dead:** it returns the dead-Chrome fixture and leaves a new daemon running, until its
  idle timeout.
- **An attached session, Chrome live:** success, but it starts a daemon that binds a new `about:blank` tab and leaves
  it open. That is one leaked tab per call, reproduced twice.

## Consent

- **Bing with the extension:** 10 `li.b_algo` results, and no visible cookie banner (no `[id^=bnp_]` element after
  1.5 s).
- **Google from a DE IP:**
  - On `www.google.com` consent was answered: the `SOCS` cookie was set, both `[role=dialog]` were `display:none`, and
    the search box was present.
  - `/search` went to `https://www.google.com/sorry/index?…`, a bot check, which the spike didn't answer.

## Windows job

A harness in a `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` job, holding a non-inherited handle, started the owner. After
`Stop-Process -Force` on the harness, the daemon and every Chrome process were gone within 3 s.

## Leftovers

- agent-browser keeps per-session files in `~/.agent-browser/`: `<s>.config` and `<s>.target`, for example
  `{"targetId":"…","url":"…","pinned":false}`, even with `--pin-tab`.
- The owner also gets `.pid`, `.port`, `.engine`, `.extensions`, `.stream` and `.version`.
- They all stay after `close` and after a hard kill.

## Assumptions

| assumption | holds? | evidence |
| --- | --- | --- |
| The zip unpacks to a loadable extension | yes | manifest at the root; CDP lists the service worker |
| The owner config opens one headed window, and `get cdp-url` gives a ws url | yes | one window, `ws://127.0.0.1:33853/devtools/browser/…` |
| Attached sessions overlap, each in its own tab of that window | yes | parallel batches, distinct targetIds, one windowId |
| `wait --timeout 3000` bounds the wait under `DEFAULT_TIMEOUT=8000` | yes | `Wait timed out after 3000ms` |
| `tab close` + `close` of one session leave the owner and the window | yes | the other tabs and the owner answered afterwards |
| `close` on `--cdp` only disconnects, never closes the tab | yes | session `e`'s tab stayed |
| `tab_gone` is a top-level `code`, and a `code` per batch entry | yes | the JSON above |
| `tab new` rebinds after `tab_gone` | yes | `tab new`, then `open`, succeeded |
| A window closed by hand makes a TCP connect to the port fail | **no** | Chrome stays alive without a window and the port accepts; calls get `tab_gone`, and `tab new` opens a new window |
| A dead Chrome makes the probe fail within 500 ms | yes, by timeout | Windows reports the refusal after about 2 s |
| `close` of an old generation's attached session works after its Chrome died | **no** | it returns the connect fixture and the daemon stays; it works without `--cdp` |
| `close` on a session without a daemon starts no daemon or Chrome | **no**, for attached sessions | the owner starts none; an attached session starts a daemon and leaks a tab (Chrome live) or the daemon (Chrome dead) |
| Owner calls never relaunch Chrome on their own | **no** | the owner's `get url` after the kill relaunched Chrome on a new port |
| Bing shows results with the extension | yes | 10 results, no banner |
| Google's consent is handled | answered | `SOCS` set, dialogs hidden; the search was blocked by `/sorry` |
| The kill-on-close job takes the daemon and Chrome | yes | all gone after the hard kill |

The spike's scripts are in the session scratchpad (`spike/scripts`). The tab closed by hand and the window closed by
hand were simulated: the tab with CDP `Target.closeTarget`, and the window with WM_CLOSE through `CloseMainWindow`.
