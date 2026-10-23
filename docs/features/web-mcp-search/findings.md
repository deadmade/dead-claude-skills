# Browser search: Task 1 findings

The facts the later tasks pin, measured on 2026-10-23 with agent-browser 0.39.1 (upstream linux-musl-x64 binary,
sha256 `74507cdab98aa91bdc14346c545aff974640a225e43f8c3d6c23164f8c0f9bb9`, as pinned) driving Helium 0.18.1.1
(Chromium 154.0.8037.57, nixpkgs) on NixOS. Chrome for Testing could not be used: it doesn't start on NixOS (D-1).

Every run used the setup the spec now prescribes: `--config` on every call, `HOME` set to a scratch folder, cwd a
scratch folder, every `AGENT_BROWSER_*` removed, one profile per engine, Consent-O-Matic loaded except for Bing.

**Networks.** Two exits were used, and each capture below says which:

- **VPN**: Proton, AS208172, Frankfurt (the controller's runs and the first half of mine).
- **Residential**: AS41110 DSLmobil (checked on ipinfo.io before every engine batch).

## Browser

### Order and version (R3)

`executablePath` is the first of:

1. `WEB_MCP_CHROME`;
2. the newest Chrome for Testing, if its `--version` starts (checked once per process; it does not on NixOS);
3. `helium` on PATH;
4. `chromium` on PATH.

Branded Chrome is never used. None found: the search fails naming `WEB_MCP_CHROME`.

The user agent carries the browser's own major version, reduced as Chrome does:
`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Safari/537.36`
(Windows: `Windows NT 10.0; Win64; x64` in place of `X11; Linux x86_64`). Where the version comes from:

- Chrome for Testing: the folder name `chrome-<a.b.c.d>`, no spawn.
- Helium: `helium --version` prints `Helium 0.18.1.1 (Chromium 154.0.8037.57)`; the major is the number after
  `Chromium `. Chromium: `chromium --version` prints `Chromium <a.b.c.d> …`.
- Checked: httpbin.org/headers received exactly the configured `User-Agent`.

### Chrome for Testing location (for Rust and TS, no spawn)

- `agent-browser install` downloads into `<home>/.agent-browser/browsers/chrome-<full version>/`, flattening the
  zip's top folder. `<home>` is `$HOME` on Linux and `%USERPROFILE%` on Windows.
- Binary: `chrome-<ver>/chrome` (Linux) or `chrome-<ver>\chrome.exe` (Windows). Upstream also accepts
  `chrome-<ver>/chrome-linux64/chrome` and `chrome-<ver>\chrome-win64\chrome.exe`.
- **Newest:** list `browsers/`, keep `chrome-<a>.<b>.<c>.<d>` entries whose binary exists, take the highest by
  comparing the four numbers **numerically**. Upstream sorts the names as strings (`chrome-99.*` beats
  `chrome-156.*`), so don't copy that.
- `install` downloads Chrome for Testing even when a branded Chrome is installed (source, `install.rs:450-460`), and
  without `--executable-path` agent-browser prefers it over a system Chrome. It checks no hash of the zip.
- Windows: upstream documents no location for it; per the source it is
  `%USERPROFILE%\.agent-browser\browsers\chrome-<ver>\chrome.exe`.

### Helium from nixpkgs dies 10 s after agent-browser launches it

- nixpkgs runs Helium inside `bwrap --die-with-parent`. agent-browser launches the browser from a tokio blocking
  thread, which tokio retires after 10 s idle; `PR_SET_PDEATHSIG` fires on that thread's exit and kills the
  browser. agent-browser avoids `PDEATHSIG` itself for exactly this reason (comment in its `chrome.rs`, upstream
  issue #1157), but the bwrap wrapper brings it back.
- Measured: the browser's processes vanish 10.0–10.5 s after `open`, every time, also inside one batch (`open`,
  `wait 12000`, `get url` answers `about:blank`); the next command silently launches a fresh browser on
  `about:blank`. Helium started by hand from a shell stays up.
- Consequences: a search whose batch crosses the 10 s mark loses its page; the profile is killed with SIGKILL, so
  cookies set in that window (consent answers) may never reach disk (a Google consent answered in one launch was
  asked again on the next); `idleTimeout` never matters for the browser.
- **Fix that works:** an `executablePath` that is a non-`exec` shell script, so bwrap's parent is that shell, not
  the tokio thread:

  ```sh
  #!/bin/sh
  /home/<user>/.nix-profile/bin/helium "$@"
  ```

  With it the browser lived past 15 s, `close` still cleaned up everything in 0.4 s (agent-browser kills the
  process group), and no wrapper shell was left. Everything below from Step 4 on was measured with this wrapper.
  **Ruling R9:** on Linux, web-mcp writes such a `#!/bin/sh` wrapper (no `exec`) beside the profile when the browser
  is helium, and uses it as `executablePath`. nixpkgs' `chromium` is not bwrap-wrapped (not tested here: it isn't
  installed).

### Helium is not plain Chromium

It loads three component extensions into every profile: **uBlock Origin**, `extstore-fixups` and the PDF viewer.
Bing still delivered its `li.b_ad` ads in the DOM (one of ten queries), so the parsers still see them. Whether a
built-in ad blocker fits "a normal user" is for the user; nothing here depends on it.

## Consent-O-Matic zip

- URL
  `https://github.com/cavi-au/Consent-O-Matic/releases/download/v1.1.5/consent-o-matic-v1.1.5-unpacked-release-chromium.zip`,
  sha256 `37cec881fc5f53c84419e39d6a01cb79ff0b06b8df556219ac5c74887ba1473a`, 88,188 bytes: all match.
- Root layout: 17 regular files at the root, no folders, no symlinks (`manifest.json`, `service.js`, `content.js`,
  `content.css`, `ui.js`, `ui.css`, `editor.js`, `editor.html`, `options.html`, `popup.html`, `templates.html`,
  `main.css`, `hide.svg`, `minimize.svg`, `logo.svg`, `icon_48.png`, `icon_96.png`).
- MV3, version 1.1.5; permissions `activeTab`, `tabs`, `storage`; host `<all_urls>`. Defaults `{A,B,D,E,F,X: false}`
  (reject everything). Rules load from `raw.githubusercontent.com` at runtime.
- Helium 154 loads it from `extensions` (registered as an unpacked command-line extension, service worker
  started), extension id `ggheiilbfpnigmoiddealbmcjhffmpmg`.

## Onboarding tab

- On a **fresh** profile Consent-O-Matic opens `chrome-extension://…/options.html` in an extra tab, headless and
  headed alike. On the second launch of the same profile it doesn't.
- agent-browser's `tab list` hides it (and the initial `chrome://newtab/`); only the CDP target list shows it.
- `get url` and `get html` read agent-browser's own tab, the one `open` navigated. The onboarding tab never got in
  the way, so nothing needs presetting for it.

## Consent walls

- Seen only at Google, and only on its home page (`https://www.google.com/?hl=en`, VPN exit, German IP). Its search
  page I only ever saw as `/sorry` (VPN, and the rate-limited residential line), so a consent wall in front of
  `/search` was never observed.
- Without the extension the wall stayed (30 s, two launches). With it, Google redirects to `consent.google.com` and
  Consent-O-Matic answers "reject":
  - **fresh profile:** cleared after ~23 s (the rule list is fetched first);
  - **warm profile** (rules cached, cookies cleared, 3 rounds): cleared after 5.1–5.3 s, `open` included;
  - **second launch:** no wall (the `SOCS` cookie persisted; with the 10 s kill above it did not).
- The fresh-profile time exceeds the 10 s engine deadline: the first Google search on a new profile in the EU will
  read a consent page.
- **Recommendation:** the ready expressions below contain **no** consent marker, so the daemon keeps waiting while
  Consent-O-Matic clicks; a consent page read at the deadline still parses as `Blocked(Consent)`. If Task 5 keeps
  "retry once", the retry has the warm-profile ~5 s.
- Bing without the extension (R7) showed no consent wall on either network (`#bnp_container` never present).
- Fixture: `google-consent.html` is the `consent.google.com` page from the home-page visit (VPN).

## Config isolation

- **`--config` replaces both auto-discovered files.** With `--config` on the call, neither a planted
  `./agent-browser.json` (`{"headed": true}`) nor `~/.agent-browser/config.json` (`{"proxy": "http://127.0.0.1:9"}`)
  had any effect, alone or together: the browser ran `--headless=new` without `--proxy-server`, and httpbin
  answered. Control without `--config`: the project file made it headed; the user file added `--proxy-server` and
  the page failed with `ERR_PROXY_CONNECTION_FAILED`.
  - This **contradicts** the spec's amended sentence "`--config` does not keep `~/.agent-browser/config.json` out
    (it merges in)". The controller's blank-page observation most likely came from a call without `--config` (which
    relaunches with the defaults anyway). Scratch `HOME` and cwd (R5) stay harmless and keep agent-browser's own
    state out of the user's folders.
- `args` is split on commas and newlines (controller); `--lang=en-US` alone is enough.
- `Accept-Language` seen by httpbin: `en-US,en;q=0.9`.

## Daemon behaviour

- **Every call carries `--config`** (controller, R4): a call without it relaunches the default browser.
- **`close` then `open` at once fails**, 5 of 5: the `open` gets `Invalid response: EOF … outcome_unknown`, an
  immediate retry `CDP WebSocket connect failed: Connection reset by peer`. With a 1 s gap: 5 of 5 fine. The
  session is gone ~0.1 s after `close` returns, when `<socket dir>/<session>.pid` and `.sock` disappear (socket dir:
  `$XDG_RUNTIME_DIR/agent-browser/` on Linux, overridable with `AGENT_BROWSER_SOCKET_DIR`); an `open` right after
  that succeeded 3 of 3. So after a `close` (Windows' `close_after`, or a failed batch) the next search on that
  engine must wait for those files to go (≤ 1 s) or retry once.
- **Idle close:** a session with `"idleTimeout": "120s"` left alone closed itself, daemon and browser, after
  121.3–121.7 s. Only `<session>.config` and `.target` stay in the socket dir.
- **`AGENT_BROWSER_DEFAULT_TIMEOUT` is per call.** The value the CLI call carries bounds that call's `wait`:
  - daemon started without it, call with 3000 / 8000: timed out after 3000 / 8000 ms (call took 4.0 / 8.9 s);
  - daemon started with 3000, call without it: 25000 ms, the default (the daemon's own env is not used);
  - so web-mcp sets it on every call, as planned.
- **CLI killed mid-`wait`** (SIGTERM or SIGKILL, 1 s into a 20 s wait): the daemon finishes the wait first; the
  next command on that session answered 20.8 s later. A killed search blocks its session for up to the timeout it
  was given, which web-mcp sets to the remaining time.
- **Batch after a failed `wait`:** without `--bail` the batch continues; `get html body` and `get url` both
  answered. The failed entry is `{"success": false, "result": null}` and the output is still a JSON list. Today's
  `batch_with` turns any failed entry into an error, so `render` must skip the `wait` entry, as planned.
- `open` reports success on a blank page (controller): the outcome comes only from the parsed page.
- A whole search batch on a running session took 0.3–2 s; the first in a session 2–5 s (browser launch included).

## English settings

| engine          | URL parameters        | note                              |
| --------------- | --------------------- | --------------------------------- |
| google          | `hl=en&gl=us&num=10`  | unverified (result page not seen) |
| bing            | `setlang=en-US&cc=US` | English page, no consent wall     |
| duckduckgo      | `kl=us-en&ia=web`     | page shows "US (English)"         |
| brave           | `source=web&lang=en`  | **`lang`** is Brave's parameter   |
| scholar         | `hl=en`               | English                           |
| semanticscholar | `sort=relevance`      | unverified (result page not seen) |

Bing, DuckDuckGo, Brave and Scholar were checked on their live result pages. `sort=relevance` is not a language
setting: Semantic Scholar has no language parameter in its URL, and its page was never seen past the challenge.

Brave: `&lang=de` turned the page German (`<html lang="de-de">`, tabs "Fragen, Alles, Bilder…"); `ui_lang` and
`country` changed nothing visible. Without `lang` the page was English already, from `Accept-Language`.

## `headed` per engine

`headed: false` for all six. Brave, Scholar, Bing and DuckDuckGo never reached 3 blocks in 10. Google and Semantic
Scholar were blocked 10 of 10 headless and headed, but only after the line had been flagged (below), so the headed
repeat says nothing about headed versus headless.

## Step 6: ten queries per engine, as the product runs them

One batch per query (`open`, `wait --fn <ready>`, `get html body`, `get url`), `AGENT_BROWSER_DEFAULT_TIMEOUT=10000`,
queries about 1 s apart, persistent profile per engine (fresh for the residential run).

| engine          | residential, headless              | residential, headed     | VPN                                        |
| --------------- | ---------------------------------- | ----------------------- | ------------------------------------------ |
| brave           | 10/10 results (0.8–2.0 s)          | not needed              | results                                    |
| scholar         | 10/10 results (0.3–2.0 s)          | not needed              | results                                    |
| bing            | 10/10 results (0.3–3.1 s)          | not needed              | controller: empty page; mine: results      |
| duckduckgo      | 9/10 results, CAPTCHA on 10th      | not needed              | controller: error-lite page; mine: results |
| google          | 10/10 `/sorry`, IP already flagged | 10/10 `/sorry`, flagged | `/sorry` CAPTCHA                           |
| semanticscholar | 10/10 "Human Verification"         | 10/10                   | "Human Verification"                       |

- **Google is rate-limited on the residential line, not blocked outright.** The user watched it show results on
  the first try; `/sorry` came only after many requests in a row. My counts were taken after that burst, from an IP
  Google had already flagged: even my first residential request, on a fresh profile, got `/sorry`, and at ~20:45 the
  controller got `/sorry` on a fresh profile with consent already cleared. So the 10/10 measures the flag, not this
  browser.
- **Semantic Scholar** answered every request on both networks, headless and headed, with its "Human Verification"
  challenge; no request ever reached a result page. The same burst caveat may apply: all residential requests came
  within minutes, ~1 s apart.
- Per R8 the Google and Semantic Scholar result-page parsers are written from current markup and their fixture
  tests are ignored until a result page is captured.
- **Live runs must space their queries like a person** (seconds to minutes apart, not ~1 s), or they measure their
  own rate limit.
- DuckDuckGo's CAPTCHA (`anomaly-modal`) came on the 10th query after ~10 s of back-to-back searching; the product
  doesn't search that fast, but the marker is real.
- Bing and DuckDuckGo answered on my VPN runs (a Proton Frankfurt exit) but not on the controller's.
  My runs had the bwrap fix and perhaps a different exit; I didn't separate the two.

## `wait --fn` expressions

Each is `!!(document.body && (results || no-results || block))`. "Checked" means the part matched its committed
fixture (loaded into a blank page) and the live page in Step 6; "unverified" parts come from markup I know, not
from a capture.

- **google**: results `#rso a h3, #search a h3` (unverified); no-results "did not match any documents"
  (unverified); block `/sorry` path or `#captcha-form` (checked).

  ```js
  !!(
    document.body &&
    (document.querySelector('#rso a h3, #search a h3') ||
      /did not match any documents/.test(
        (document.querySelector('#topstuff, #botstuff, #rcnt') || {}).innerText || '',
      ) ||
      location.pathname.startsWith('/sorry') ||
      document.querySelector('#captcha-form, form[action="index"] #recaptcha'))
  );
  ```

- **bing**: results `#b_results > li.b_algo` and no-results `#b_results > li.b_no` (both checked); block
  unverified.

  ```js
  !!(
    document.body &&
    (document.querySelector('#b_results > li.b_algo') ||
      document.querySelector('#b_results > li.b_no') ||
      location.pathname.startsWith('/challenge') ||
      document.querySelector('#b_captcha, iframe[src*="captcha"], iframe[src*="challenges.cloudflare.com"]'))
  );
  ```

- **duckduckgo**: all three checked (results; "No results found for" in a `mainline` section; the anomaly modal and
  the html endpoint's error-lite page).

  ```js
  !!(
    document.body &&
    (document.querySelector('article[data-testid="result"]') ||
      [...document.querySelectorAll('[data-testid="mainline"]')].some((m) =>
        /No results found for/.test(m.textContent),
      ) ||
      document.querySelector('a[href^="mailto:error-lite"], .anomaly-modal__title'))
  );
  ```

- **brave**: results checked; no-results and block unverified (Brave never showed either).

  ```js
  !!(
    document.body &&
    (document.querySelector('.snippet[data-type="web"]') ||
      /No results found|Not many great matches/.test(
        (document.querySelector('#results, main') || {}).innerText || '',
      ) ||
      /captcha/i.test(location.pathname + ' ' + document.title) ||
      document.querySelector('#captcha, form[action*="captcha"]'))
  );
  ```

- **scholar**: results and no-results checked; block unverified.

  ```js
  !!(
    document.body &&
    (document.querySelector('#gs_res_ccl_mid .gs_r.gs_or .gs_ri') ||
      /did not match any articles/.test((document.querySelector('#gs_res_ccl_top') || {}).innerText || '') ||
      location.pathname.startsWith('/sorry') ||
      document.querySelector('#gs_captcha_ccl, #captcha-form, #recaptcha'))
  );
  ```

- **semanticscholar**: block checked (both challenge stages); results and no-results unverified.

  ```js
  !!(
    document.body &&
    (document.querySelector('[data-test-id="search-result"], .cl-paper-row') ||
      /No results|could not find any|couldn.t find any/i.test(
        (document.querySelector('[data-test-id="search-results"], main') || {}).innerText || '',
      ) ||
      document.querySelector('#captcha-container, #challenge-container') ||
      document.title === 'Human Verification')
  );
  ```

Notes for the parsers:

- Semantic Scholar's challenge has two stages: first a 772-byte noscript page ("we need to verify that you're not a
  robot"), then the rendered AWS WAF page ("Let's confirm you are human", `#captcha-container`). The ready
  expression fires on the first, so the parser must call both `Captcha`. Once, on the VPN, `get html body` failed
  (`Element not found: body`) during the challenge; the next read worked.
- Scholar's page always carries a hidden "The system can't perform the operation now" div: not a block marker.
- Brave answers nonsense queries with relaxed results ("search operators were not applied", "Too few matches"),
  never with an empty page (5 tries).
- Google's `/sorry` page is English with `hl=en`; its marker is `form#captcha-form` holding `div#recaptcha`.

## Fixtures

In `crates/web-mcp/tests/fixtures/engines/`, each the `get html body` of the page (script bodies dropped in the two
Bing files, which are still ~300 KB). Scrubbed: in `google-captcha.html` the client IP (now `0.0.0.0`), the `q`
token that encodes it, `sei` and the reCAPTCHA `data-s`/`s=` tokens (now `DUMMY`); in `google-consent.html` the
`escs` token (`DUMMY`) and the account sign-in URLs (`#`); in `bing.html` the located place and coordinates
(`data-lat="0"`, `data-lon="0"`, empty `data-disp`). No parser marker lives in any of them.

| file                                    | network     | what                                                   |
| --------------------------------------- | ----------- | ------------------------------------------------------ |
| `brave.html`                            | residential | `tokio select cancellation safety`, 20 web results     |
| `scholar.html`                          | residential | `retrieval augmented generation`, 10 results           |
| `scholar-none.html`                     | VPN         | quoted nonsense query: "did not match any articles"    |
| `bing.html`                             | residential | `tokio select cancellation safety`, 10 results         |
| `bing-ads.html`                         | residential | `postgres partial index example`, with `li.b_ad` ads   |
| `bing-none.html`                        | residential | nonsense query: `li.b_no` "There are no results for"   |
| `duckduckgo.html`                       | residential | `tokio select cancellation safety`, 10 results         |
| `duckduckgo-none.html`                  | VPN         | quoted nonsense query: "No results found for"          |
| `duckduckgo-captcha.html`               | residential | anomaly modal ("bots use DuckDuckGo too")              |
| `duckduckgo-captcha-lite.html`          | VPN         | html.duckduckgo.com error-lite page (controller's run) |
| `google-captcha.html`                   | residential | `/sorry` "unusual traffic" reCAPTCHA                   |
| `google-consent.html`                   | VPN         | `consent.google.com` (reached from the home page)      |
| `semanticscholar-captcha.html`          | residential | AWS WAF "Let's confirm you are human"                  |
| `semanticscholar-captcha-noscript.html` | residential | the challenge's first, noscript stage                  |

**Not obtained** (their Task 2 tests are dropped, or ignored per R8; the case falls to `Unrecognised`):

- `google.html`, `google-none.html`: `/sorry` on the VPN, and on the residential line only after it was flagged
  (rate limit, see Step 6).
- `semanticscholar.html`, `semanticscholar-none.html`: challenge on every request, both networks (burst caveat).
- `brave-none.html`: Brave never shows an empty result page.
- `bing-captcha.html`, `brave-captcha.html`, `scholar-captcha.html`: never blocked. Bing's empty page on the
  controller's VPN run had no markup (1 byte), so it is no fixture.
- `bing-consent.html` and any consent page in front of a search: never seen.
