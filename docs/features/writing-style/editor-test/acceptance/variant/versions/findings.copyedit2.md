# Browser search: Task 1 findings

This document records the facts the later tasks pin. They were measured on 2026-10-23 with agent-browser 0.39.1
(upstream linux-musl-x64 binary, sha256 `74507cdab98aa91bdc14346c545aff974640a225e43f8c3d6c23164f8c0f9bb9`, as
pinned) driving Helium 0.18.1.1 (Chromium 154.0.8037.57, nixpkgs) on NixOS. Chrome for Testing could not be used,
because it doesn't start on NixOS (D-1).

Every run used the setup the spec now prescribes:

- `--config` on every call;
- `HOME` set to a scratch folder;
- cwd set to a scratch folder;
- every `AGENT_BROWSER_*` removed;
- one profile per engine;
- Consent-O-Matic loaded for every engine except Bing.

**Networks.** The runs used two exits, and each capture below says which:

- **VPN**: a Proton exit in Frankfurt, AS208172, used for the controller's runs and the first half of mine.
- **Residential**: AS41110 DSLmobil, checked on ipinfo.io before every engine batch.

## Browser

### Order and version (R3)

`executablePath` is the first of:

1. `WEB_MCP_CHROME`;
2. the newest Chrome for Testing, if its `--version` starts (checked once per process; it does not on NixOS);
3. `helium` on PATH;
4. `chromium` on PATH.

Branded Chrome is never used. If none of these is found, the search fails with an error naming `WEB_MCP_CHROME`.

The user agent carries the browser's own major version, reduced as Chrome does:
`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Safari/537.36`.
On Windows, `Windows NT 10.0; Win64; x64` takes the place of `X11; Linux x86_64`. The version comes from these
sources:

- For Chrome for Testing, it is read from the folder name `chrome-<a.b.c.d>`, with no spawn.
- For Helium, `helium --version` prints `Helium 0.18.1.1 (Chromium 154.0.8037.57)`, and the major version is the
  number after `Chromium `.
- For Chromium, `chromium --version` prints `Chromium <a.b.c.d> …`.

A check confirmed the result: httpbin.org/headers received exactly the configured `User-Agent`.

### Chrome for Testing location (for Rust and TS, no spawn)

- `agent-browser install` downloads into `<home>/.agent-browser/browsers/chrome-<full version>/`, flattening the
  zip's top folder. `<home>` is `$HOME` on Linux and `%USERPROFILE%` on Windows.
- The binary is `chrome-<ver>/chrome` on Linux and `chrome-<ver>\chrome.exe` on Windows. Upstream also accepts
  `chrome-<ver>/chrome-linux64/chrome` and `chrome-<ver>\chrome-win64\chrome.exe`.
- **Newest:** to find the newest, list `browsers/`, keep the `chrome-<a>.<b>.<c>.<d>` entries whose binary exists,
  and take the highest by comparing the four numbers **numerically**. Upstream sorts the names as strings, so
  `chrome-99.*` beats `chrome-156.*`; don't copy that.
- `install` downloads Chrome for Testing even when a branded Chrome is installed (source, `install.rs:450-460`).
  Without `--executable-path`, agent-browser prefers it over a system Chrome. It checks no hash of the zip.
- Upstream documents no location for it on Windows. According to the source, it is
  `%USERPROFILE%\.agent-browser\browsers\chrome-<ver>\chrome.exe`.

### Helium from nixpkgs dies 10 s after agent-browser launches it

- nixpkgs runs Helium inside `bwrap --die-with-parent`. agent-browser launches the browser from a tokio blocking
  thread, and tokio retires that thread after 10 s idle. When the thread exits, `PR_SET_PDEATHSIG` fires and kills
  the browser. agent-browser itself avoids `PDEATHSIG` for exactly this reason (see the comment in its `chrome.rs`
  and upstream issue #1157), but the bwrap wrapper brings it back.
- As measured, the browser's processes vanish 10.0–10.5 s after `open`, every time. This happens inside one batch
  too: in the batch `open`, `wait 12000`, `get url`, the `get url` answers `about:blank`. The next command silently
  launches a fresh browser on `about:blank`. By contrast, Helium started by hand from a shell stays up.
- This has three consequences:
  - A search whose batch crosses the 10 s mark loses its page.
  - The profile is killed with SIGKILL, so cookies set in that window, such as consent answers, may never reach
    disk. Google asked again on the next launch for a consent answered in the previous one.
  - `idleTimeout` never matters for the browser.
- **Fix that works:** make `executablePath` a non-`exec` shell script, so bwrap's parent is that shell, not the
  tokio thread:

  ```sh
  #!/bin/sh
  /home/<user>/.nix-profile/bin/helium "$@"
  ```

  With this wrapper, the browser lived past 15 s, `close` still cleaned up everything in 0.4 s (agent-browser kills
  the process group), and no wrapper shell was left behind. Every measurement below, from Step 4 on, used this
  wrapper. **Ruling R9:** on Linux, when the browser is helium, web-mcp writes such a `#!/bin/sh` wrapper (no
  `exec`) beside the profile and uses it as `executablePath`. nixpkgs' `chromium` is not bwrap-wrapped (not tested
  here, because it isn't installed).

### Helium is not plain Chromium

Helium loads three component extensions into every profile: **uBlock Origin**, `extstore-fixups` and the PDF
viewer. Even so, Bing still delivered its `li.b_ad` ads in the DOM (one of ten queries), so the parsers still see
them. The user decides whether a built-in ad blocker fits "a normal user"; nothing here depends on it.

## Consent-O-Matic zip

- The URL, sha256 and size all match: the URL
  `https://github.com/cavi-au/Consent-O-Matic/releases/download/v1.1.5/consent-o-matic-v1.1.5-unpacked-release-chromium.zip`,
  the sha256 `37cec881fc5f53c84419e39d6a01cb79ff0b06b8df556219ac5c74887ba1473a` and the size of 88,188 bytes.
- The zip's root holds 17 regular files, with no folders and no symlinks: `manifest.json`, `service.js`,
  `content.js`, `content.css`, `ui.js`, `ui.css`, `editor.js`, `editor.html`, `options.html`, `popup.html`,
  `templates.html`, `main.css`, `hide.svg`, `minimize.svg`, `logo.svg`, `icon_48.png`, `icon_96.png`.
- The extension is MV3, version 1.1.5, with the permissions `activeTab`, `tabs` and `storage` and the host
  `<all_urls>`. Its defaults are `{A,B,D,E,F,X: false}`, which rejects everything. It loads its rules from
  `raw.githubusercontent.com` at runtime.
- Helium 154 loads it from `extensions`, registers it as an unpacked command-line extension with the extension id
  `ggheiilbfpnigmoiddealbmcjhffmpmg`, and starts its service worker.

## Onboarding tab

- On a **fresh** profile, Consent-O-Matic opens `chrome-extension://…/options.html` in an extra tab, headless and
  headed alike. On the second launch of the same profile, it doesn't.
- agent-browser's `tab list` hides that tab, as it hides the initial `chrome://newtab/`; only the CDP target list
  shows it.
- `get url` and `get html` read agent-browser's own tab, the one `open` navigated. The onboarding tab never got in
  the way, so nothing needs presetting for it.

## Consent walls

- A consent wall appeared only at Google, and only on its home page (`https://www.google.com/?hl=en`, VPN exit,
  German IP). I only ever saw Google's search page as `/sorry` (on the VPN, and on the rate-limited residential
  line), so I never observed a consent wall in front of `/search`.
- Without the extension, the wall stayed (30 s, two launches). With it, Google redirects to `consent.google.com`
  and Consent-O-Matic answers "reject":
  - **fresh profile:** the wall cleared after ~23 s, because the rule list is fetched first;
  - **warm profile** (rules cached, cookies cleared, 3 rounds): the wall cleared after 5.1–5.3 s, `open` included;
  - **second launch:** no wall appeared, because the `SOCS` cookie persisted; with the 10 s kill above, it did not
    persist.
- The fresh-profile time exceeds the 10 s engine deadline, so on a new profile in the EU, the first Google search
  will read a consent page.
- **Recommendation:** the ready expressions below contain **no** consent marker, so the daemon keeps waiting while
  Consent-O-Matic clicks. A consent page read at the deadline still parses as `Blocked(Consent)`. If Task 5 keeps
  "retry once", the retry gets the warm-profile time of ~5 s.
- Bing, which runs without the extension (R7), showed no consent wall on either network: `#bnp_container` was never
  present.
- The fixture `google-consent.html` is the `consent.google.com` page from the home-page visit on the VPN.

## Config isolation

- **`--config` replaces both auto-discovered files.** Two files were planted: `./agent-browser.json` with
  `{"headed": true}` and `~/.agent-browser/config.json` with `{"proxy": "http://127.0.0.1:9"}`. With `--config` on
  the call, neither had any effect, alone or together: the browser ran `--headless=new` without `--proxy-server`,
  and httpbin answered. In the control run without `--config`, the project file made the browser headed, and the
  user file added `--proxy-server`, so the page failed with `ERR_PROXY_CONNECTION_FAILED`.
  - This **contradicts** the spec's amended sentence "`--config` does not keep `~/.agent-browser/config.json` out
    (it merges in)". The blank page the controller observed most likely came from a call without `--config`, which
    relaunches with the defaults anyway. Scratch `HOME` and cwd (R5) remain harmless, and they keep agent-browser's
    own state out of the user's folders.
- `args` is split on commas and newlines (per the controller); `--lang=en-US` alone is enough.
- httpbin saw `Accept-Language` as `en-US,en;q=0.9`.

## Daemon behaviour

- **Every call carries `--config`** (controller, R4), because a call without it relaunches the default browser.
- **`close` then `open` at once fails**, 5 of 5 times: the `open` gets `Invalid response: EOF … outcome_unknown`,
  and an immediate retry gets `CDP WebSocket connect failed: Connection reset by peer`. With a 1 s gap, 5 of 5
  were fine. The session is gone ~0.1 s after `close` returns, when `<socket dir>/<session>.pid` and `.sock`
  disappear; an `open` right after that succeeded 3 of 3 times. The socket dir is `$XDG_RUNTIME_DIR/agent-browser/`
  on Linux, overridable with `AGENT_BROWSER_SOCKET_DIR`. So after a `close`, whether Windows' `close_after` or a
  failed batch, the next search on that engine must wait for those files to go (≤ 1 s) or retry once.
- **Idle close:** a session with `"idleTimeout": "120s"` that was left alone closed itself, daemon and browser,
  after 121.3–121.7 s. Afterwards, only `<session>.config` and `.target` stay in the socket dir.
- **`AGENT_BROWSER_DEFAULT_TIMEOUT` is per call.** The value each CLI call carries bounds that call's `wait`:
  - with the daemon started without it and the call carrying 3000 / 8000, the wait timed out after 3000 / 8000 ms
    (the call took 4.0 / 8.9 s);
  - with the daemon started with 3000 and the call without it, the timeout was 25000 ms, the default, because the
    daemon doesn't use its own env;
  - so web-mcp sets it on every call, as planned.
- **CLI killed mid-`wait`** (SIGTERM or SIGKILL, 1 s into a 20 s wait): the daemon finishes the wait first, and the
  next command on that session answered 20.8 s later. A killed search therefore blocks its session for up to its
  timeout, which web-mcp sets to the remaining time.
- **Batch after a failed `wait`:** without `--bail`, the batch continues, and `get html body` and `get url` both
  answered. The failed entry is `{"success": false, "result": null}`, and the output is still a JSON list. Today's
  `batch_with` turns any failed entry into an error, so `render` must skip the `wait` entry, as planned.
- `open` reports success even on a blank page (per the controller), so the outcome comes only from the parsed page.
- A whole search batch took 0.3–2 s on a running session, and 2–5 s as the first batch in a session, browser launch
  included.

## English settings

| engine          | URL parameters        | note                              |
| --------------- | --------------------- | --------------------------------- |
| google          | `hl=en&gl=us&num=10`  | unverified (result page not seen) |
| bing            | `setlang=en-US&cc=US` | English page, no consent wall     |
| duckduckgo      | `kl=us-en&ia=web`     | page shows "US (English)"         |
| brave           | `source=web&lang=en`  | **`lang`** is Brave's parameter   |
| scholar         | `hl=en`               | English                           |
| semanticscholar | `sort=relevance`      | unverified (result page not seen) |

The settings for Bing, DuckDuckGo, Brave and Scholar were checked on their live result pages. `sort=relevance` is
not a language setting: Semantic Scholar has no language parameter in its URL, and no run saw its page past the
challenge.

On Brave, `&lang=de` turned the page German (`<html lang="de-de">`, tabs "Fragen, Alles, Bilder…"), while
`ui_lang` and `country` changed nothing visible. Without `lang`, the page was already English, from
`Accept-Language`.

## `headed` per engine

All six engines get `headed: false`. Brave, Scholar, Bing and DuckDuckGo never reached 3 blocks in 10. Google and
Semantic Scholar were blocked 10 of 10 times, headless and headed, but only after the line had been flagged (see
below), so the headed repeat says nothing about headed versus headless.

## Step 6: ten queries per engine, as the product runs them

Each query ran as one batch (`open`, `wait --fn <ready>`, `get html body`, `get url`) with
`AGENT_BROWSER_DEFAULT_TIMEOUT=10000`. Queries ran about 1 s apart, with a persistent profile per engine (fresh for
the residential run).

| engine          | residential, headless              | residential, headed     | VPN                                        |
| --------------- | ---------------------------------- | ----------------------- | ------------------------------------------ |
| brave           | 10/10 results (0.8–2.0 s)          | not needed              | results                                    |
| scholar         | 10/10 results (0.3–2.0 s)          | not needed              | results                                    |
| bing            | 10/10 results (0.3–3.1 s)          | not needed              | controller: empty page; mine: results      |
| duckduckgo      | 9/10 results, CAPTCHA on 10th      | not needed              | controller: error-lite page; mine: results |
| google          | 10/10 `/sorry`, IP already flagged | 10/10 `/sorry`, flagged | `/sorry` CAPTCHA                           |
| semanticscholar | 10/10 "Human Verification"         | 10/10                   | "Human Verification"                       |

- **Google is rate-limited on the residential line, not blocked outright.** The user watched Google show results on
  the first try; `/sorry` came only after many requests in a row. I took my counts after that burst, from an IP
  Google had already flagged. Even my first residential request, on a fresh profile, got `/sorry`, and at ~20:45
  the controller got `/sorry` on a fresh profile with consent already cleared. So the 10/10 measures the flag, not
  this browser.
- **Semantic Scholar** answered every request on both networks, headless and headed, with its "Human Verification"
  challenge. No request ever reached a result page. The same burst caveat may apply: all residential requests came
  within minutes, ~1 s apart.
- Per R8, the result-page parsers for Google and Semantic Scholar are written from current markup, and their fixture
  tests are ignored until a result page is captured.
- **Live runs must space their queries like a person** (seconds to minutes apart, not ~1 s), or they measure their
  own rate limit.
- DuckDuckGo's CAPTCHA (`anomaly-modal`) came on the 10th query, after ~10 s of back-to-back searching. The product
  doesn't search that fast, but the marker is real.
- Bing and DuckDuckGo answered on my VPN runs (a Proton Frankfurt exit) but not on the controller's. My runs had
  the bwrap fix and perhaps a different exit; I didn't separate the two.

## `wait --fn` expressions

Each expression has the form `!!(document.body && (results || no-results || block))`. A part marked "checked"
matched both its committed fixture (loaded into a blank page) and the live page in Step 6. Parts marked
"unverified" come from markup I know, not from a capture.

- **google**: the results part `#rso a h3, #search a h3` is unverified; the no-results part "did not match any
  documents" is unverified; the block part, the `/sorry` path or `#captcha-form`, is checked.

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

- **bing**: the results part `#b_results > li.b_algo` and the no-results part `#b_results > li.b_no` are both
  checked; the block part is unverified.

  ```js
  !!(
    document.body &&
    (document.querySelector('#b_results > li.b_algo') ||
      document.querySelector('#b_results > li.b_no') ||
      location.pathname.startsWith('/challenge') ||
      document.querySelector('#b_captcha, iframe[src*="captcha"], iframe[src*="challenges.cloudflare.com"]'))
  );
  ```

- **duckduckgo**: all three parts are checked (results; "No results found for" in a `mainline` section; the anomaly
  modal and the html endpoint's error-lite page).

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

- **brave**: results are checked; no-results and block are unverified, because Brave never showed either. The block
  marker is DOM only, `#captcha, form[action*="captcha"]`. It has no title or path test, because Brave puts the
  query in the title (R14).

  ```js
  !!(
    document.body &&
    (document.querySelector('.snippet[data-type="web"]') ||
      /No results found|Not many great matches/.test(
        (document.querySelector('#results, main') || {}).innerText || '',
      ) ||
      document.querySelector('#captcha, form[action*="captcha"]'))
  );
  ```

- **scholar**: results and no-results are checked; block is unverified.

  ```js
  !!(
    document.body &&
    (document.querySelector('#gs_res_ccl_mid .gs_r.gs_or .gs_ri') ||
      /did not match any articles/.test((document.querySelector('#gs_res_ccl_top') || {}).innerText || '') ||
      location.pathname.startsWith('/sorry') ||
      document.querySelector('#gs_captcha_ccl, #captcha-form, #recaptcha'))
  );
  ```

- **semanticscholar**: block is checked (both challenge stages); results and no-results are unverified.

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

- Semantic Scholar's challenge comes in two stages: first a 772-byte noscript page ("we need to verify that you're
  not a robot"), then the rendered AWS WAF page ("Let's confirm you are human", `#captcha-container`). The ready
  expression fires on the first stage, so the parser must call both stages `Captcha`. Once, on the VPN, `get html
  body` failed during the challenge (`Element not found: body`); the next read worked.
- Scholar's page always carries a hidden "The system can't perform the operation now" div, which is not a block
  marker.
- Brave answers nonsense queries with relaxed results ("search operators were not applied", "Too few matches"),
  never with an empty page (in 5 tries).
- Google's `/sorry` page is English with `hl=en`; its marker is `form#captcha-form` holding `div#recaptcha`.

## Fixtures

The fixtures are in `crates/web-mcp/tests/fixtures/engines/`. Each is the `get html body` of its page; script bodies
were dropped in the two Bing files, which are still ~300 KB. Three files were scrubbed:

- in `google-captcha.html`, the client IP (now `0.0.0.0`), the `q` token that encodes it, `sei` and the reCAPTCHA
  `data-s`/`s=` tokens (now `DUMMY`);
- in `google-consent.html`, the `escs` token (`DUMMY`) and the account sign-in URLs (`#`);
- in `bing.html`, the located place and coordinates (`data-lat="0"`, `data-lon="0"`, empty `data-disp`).

No parser marker lives in any of them.

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

**Not obtained** (their Task 2 tests are dropped, or ignored per R8, and the case falls to `Unrecognised`):

- `google.html`, `google-none.html`: Google answered `/sorry` on the VPN, and on the residential line only after the
  line was flagged (rate limit, see Step 6).
- `semanticscholar.html`, `semanticscholar-none.html`: Semantic Scholar answered every request on both networks
  with its challenge (burst caveat).
- `brave-none.html`: Brave never shows an empty result page.
- `bing-captcha.html`, `brave-captcha.html`, `scholar-captcha.html`: these engines never blocked a request. Bing's
  empty page on the controller's VPN run had no markup (1 byte), so it is not a fixture.
- `bing-consent.html` and any consent page in front of a search: neither was ever seen.
