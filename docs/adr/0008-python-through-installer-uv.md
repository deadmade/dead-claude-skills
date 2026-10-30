# Python runs through an installer-managed uv

headroom-trim is the first plugin here whose code is Python: it needs headroom's library (`headroom-ai`), which has no
Rust or Node equivalent that keeps headroom's protections. The user wants it on every machine the installer sets up,
including machines without Python or uv, and wants headroom updated like any other dependency.

Python code ships as a uv project (`pyproject.toml` + `uv.lock`) inside its plugin. The installer keeps a pinned uv the
way it keeps agent-browser: the version and each platform archive's sha256 sit in `installer/assets/uv.json`. Once its
own copy in `~/.claude/bin` exists, that copy wins and is upgraded when older than the pin; a uv on PATH at or above
the pin is used only while it is absent, so the installer and the plugin run the same uv. It then runs `uv sync`, so
Python and the wheels are fetched at install time. The plugin finds that uv itself (`~/.claude/bin` first, then
absolute PATH entries) and runs its code with `uv run --locked`, which fetches only when the lockfile changed. Dependabot's `uv` ecosystem bumps the lockfile weekly, and a weekly
`sync.yml` job bumps the uv pin.

## Considered options

- **uv on PATH only, with an installer hint.** Rejected: the user doesn't have uv on every machine.
- **A frozen executable (PyInstaller or Nuitka) built in CI**, downloaded like tui-review and web-mcp. Rejected: fragile
  with headroom's native extension, large, and every headroom bump would need a new build and an installer rerun.
- **The installer builds a venv itself** (`uv venv` + `uv pip install --require-hashes`). Rejected: the same result as
  `uv sync` from a lockfile, with more of our own code.
- **The plugin downloads uv on first use.** Rejected: a hook would fetch and run a binary on its own.
- **A Rust binary over headroom's Rust core.** Rejected: headroom's tool exclusions and error protections live in its
  Python router.

## Consequences

- A Python dependency bump reaches machines through the marketplace auto-update. The first start after it fetches the
  new wheels once through `uv run --locked`, unless the installer ran first. Rust binaries still need an installer rerun.
- `test.yml` sets up uv (`astral-sh/setup-uv`, pinned) to run the Python tests on Linux and Windows.
- The next Python plugin follows the same shape: a uv project, the installer's uv, Dependabot.
