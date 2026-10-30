# Chrome for Testing is never found on Windows, and a Chrome window flashes instead

- **Seen:** 2026-10-30, the web-mcp one-window live check: without `WEB_MCP_CHROME`, every call answered "no browser
  for search" after 5 s, and a Chrome for Testing window opened each time. The installer's `searchBrowserWorks` did the
  same.
- **Cause:** both checked a browser by running `chrome.exe --version` and waiting for it to exit. On Windows, Chrome
  doesn't print its version: it starts a browser and keeps running, so the check timed out and Chrome for Testing was
  rejected (`crates/web-mcp/src/profile.rs`, `version()` and `pick`; `installer/system/browser.ts`,
  `searchBrowserWorks`).
- **Fix:** d09fd2e. On Windows nothing starts the binary: a Chrome for Testing that exists counts, and its major
  version comes from its folder name (`~/.agent-browser/browsers/chrome-<version>/chrome-win64/chrome.exe`).
- **Spot it next time:** never probe a GUI program with `--version` on Windows without checking that it exits. Run the
  live check without the override environment variables too (`WEB_MCP_CHROME` hid this).
