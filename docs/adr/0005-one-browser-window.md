# One browser window per web-mcp, shared by search and browsing

Each search engine used to run its own Chrome with its own profile. Every Chrome loaded a cookie-banner extension, and
agent-browser treats a Chrome with extensions as headed. So on Windows every search flashed 4 to 6 windows, closed
again after the search.

Now each web-mcp server keeps one **owner** agent-browser session. agent-browser launches its Chrome on the server's
first need for a browser, and the server keeps it until it exits. Every engine, `browser` session and fetch fallback
is a tab of that Chrome: it attaches with `--cdp <the owner's get cdp-url> --pin-tab`. The user wanted one window to
manage, accepted that it is visible (engines reject hidden browsers anyway) and does not mind cookies being shared.

This partly supersedes ADR 0004: pages Claude opens now share a profile with the searches and can set cookies later
searches see.

## Considered options

- **web-mcp launches Chrome itself.** Rejected in plan review. agent-browser already launches Chrome, ties it to its
  daemon with a job object on Windows and a process group on Linux, starts Xvfb when Linux has no display, and finds
  the DevTools port. A parent-death signal on Linux fires when the spawning thread exits, so it kills Chrome early.
- **One shared session, everything run one after another in tabs.** Rejected: a search would take as long as all
  its engines together, and searches would wait while Claude browses.
- **Per-engine Chromes moved off-screen and kept warm.** Rejected: still several browsers, not one window.
- **One window shared by every web-mcp on the machine.** Rejected by the user in favour of one window per Claude
  session. Each server holds the first free **profile slot**, so cookies still carry over between sessions.

## Consequences

- **Chrome's lifetime:**
  - On Windows, web-mcp puts itself in a kill-on-close job, so its daemons, and through them Chrome, go when it goes.
  - On Linux, a hard-killed web-mcp leaves its owner session behind. The next server that takes the slot closes it.
- **Session names carry a generation.** A window the user closed is replaced by a new owner, and no session keeps
  pointing at the dead Chrome.
- **One extension for every tab.** A single Chrome can't load it for some engines and not others.
- **The `browser` tool and the fetch fallback need the window too:** a search folder, a non-branded browser and,
  on Linux, a display or Xvfb. The installer warns when they are missing.
