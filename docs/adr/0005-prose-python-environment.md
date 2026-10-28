# The installer sets up a Python environment for flows' prose measures

flows' `/copyedit` measures a document with spaCy and its transformer model, `en_core_web_trf`, before an Opus editor
applies Williams and Bizup's _Style_ to it. A test showed the editor does best with those measures in hand. spaCy is
Python, and the model needs PyTorch, so the installer, until now Node only, sets up a Python environment of about
1.5 GB, behind a toggle that is on by default when flows is selected. On Windows and Linux it runs `uv sync --frozen` on a
locked project in `installer/assets/prose/`, with uv from PATH, into `~/.claude/flows-prose/`. NixOS waits for a later
change: uv's Python and PyTorch's Linux wheels don't run there, and nixpkgs' model doesn't load.

## Considered options

- **A Rust port of the measures on Harper's tagger and noun-phrase chunker.** One binary per platform, like
  tui-review and web-mcp, with no Python. Rejected by the user ("Let's just stay on python"); Harper has no full
  sentence parser, so the sentence-shape measures would be approximate.
- **spaCy's small model.** About 12 MB instead of 1.5 GB, but untested; the user chose the large model the test used
  ("Large pls").
- **No measures, the editor alone.** It ranked second in the test, behind the editor with measures. It remains the
  fallback whenever the environment is missing.
- **A pinned uv download in the installer.** Rejected after plan review: graphify already expects uv on PATH, and a
  pin needs its own sync workflow.
- **For NixOS, nixpkgs' spaCy and model.** The model doesn't build against nixpkgs' spacy-curated-transformers, and
  with that check relaxed it builds but its weights don't load (tested 2026-10-28). Running the uv environment inside
  an FHS environment (`buildFHSEnv`) worked in a test and is the likely way to add NixOS later; nix-ld is another.

## Consequences

- The installer now depends on a Python toolchain it doesn't ship. A missing uv is a line in the summary's "Missing on
  PATH" note, never a failed install. On NixOS the toggle is hidden until NixOS is supported.
- The lock pins spaCy, PyTorch and the model; nothing bumps it automatically. Updating it means running `uv lock` in
  `installer/assets/prose/` and checking that the editor's measures still load.
- Without the environment, `/copyedit` still edits, without spaCy's candidates.
