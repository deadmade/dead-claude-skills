# tui-review

`/tui-review` opens a diff pane beside the chat, so you can read a branch's changes and ask Claude about them in the
same session. The diff, highlighting and git work happen in the `tui-review` binary (Rust, `crates/tui-review/`). The mod only paints,
from small binary chunk files the binary writes to disk, so a 100k-line PR costs the same memory and frame time as a 100-line one.

## Install

Pick it in the installer (see the [main README](../../../README.md)).

It needs the `tui-review` binary. The installer (`npx --allow-git=root github:deadmade/dead-claude-skills#semver:*`) downloads the build for your machine
into `~/.claude/bin` and sets the plugin's `binPath`, unless a `tui-review` is already on PATH. By hand: unpack the `tui-review-*`
archive for your platform from the [releases](https://github.com/deadmade/dead-claude-skills/releases), or build it,
and put it on PATH or set its path with `/plugin configure tui-review`:

    cargo build --release --manifest-path crates/tui-review/Cargo.toml   # or: nix build .#tui-review

## Use

    /tui-review            this branch against the branch it is stacked on
    /tui-review <base>     against <base> (a branch, remote branch or commit); remembered for this branch
    /tui-review demo       a generated 100k-line review

**The base.** For `main → b1 → b2`, reviewing `b2` shows only `b2`'s own commits: the base is the branch whose
merge-base with HEAD is nearest. A base that moved on after you branched stays the base, and its new commits stay out
(the diff is always `merge-base..HEAD`). Branches stacked on top of yours and your branch's own remote copy are never
picked. The pane's title shows `head ← base`, so a wrong pick is visible at once; `/tui-review <base>` fixes it, and is
saved as `git config branch.<name>.tuiReviewBase` (a base saved as `brvBase`, from before the binary was renamed, still counts). Only committed changes are shown.

**Following HEAD.** After each Bash command Claude runs, and when you come back to the pane, the review runs again. If
HEAD has not moved, `tui-review` answers from its cache at once and nothing changes; after a commit, checkout or rebase the new
review opens in place, on the file you were in, with your unsent comments moved onto it.

**Claude knows where you are.** Each prompt you send while the pane is open carries a note Claude reads and you don't
see: which diff is open (`git diff <merge-base>..<head>`) and the cursor's `path:line`. So "why is this here?" means the
line you are on.

The pane docks beside the chat under Claude Code's fullscreen renderer (`/tui fullscreen`, once) in a terminal at least
110 columns wide; otherwise it opens above the prompt. It takes the keyboard when it opens. Esc goes back to the prompt
to type a question; ctrl+x tab goes back to the pane.

| Key         |                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `j` / `k`   | cursor down / up; the window follows it                                                                   |
| mouse wheel | scroll the window; the cursor stays in it                                                                 |
| `n` / `p`   | cursor to the next / previous file (`p` inside a file goes to its own header first)                       |
| `r`         | mark the cursor's file viewed and collapse it to its header; on a viewed file, clear the mark and open it |
| `c`         | comment on the cursor's line, or on the whole file from its header; on a commented line, edit the comment |
| `s`         | send every comment to Claude as one message, then clear them                                              |
| `q`         | close the pane (so do the frame's close mark and ctrl+x x)                                                |

Closing the pane lets the review go; `/tui-review` opens it again. A new conversation (`/clear`, a resume, a new
session) closes it too, and drops comments that were not sent.

"Viewed" marks persist across sessions, by the file's content: a rebase that leaves a file alone keeps its mark (and
the file opens collapsed), a change to it clears it. The header bar counts them.

Lockfiles and minified files are listed with their `+/−` counts but not shown line by line; so are binary files. Code
is coloured with tree-sitter for Rust, C#, TypeScript/TSX, JavaScript, Python, Nix, JSON, YAML, TOML and Bash; other
files are plain. The text shows first and the colours follow a moment later.

### Comments

Claude doesn't see the pane, so comments are how you point at code. `c` opens a field under the diff: Enter saves the
comment, an empty one cancels it (or deletes the comment you were editing). A saved comment shows under its line,
wrapped to the pane, with a `●` in the line's gutter; the header bar and the `send` button count the comments waiting.
`s` sends them all as one prompt, in your name: for each, `path:line` (or the file, for a comment on its header), the
commented line with up to two lines before it from its hunk, and your text. Then they are cleared. Comments live in the
session, so a reload of the mod keeps them.

The arrow keys don't scroll yet: the engine only forwards them while a pane has rows of its own to scroll.

The status line shows `load · paint · chunks` for the last frame.

## The binary

    tui-review review [--base REF] [--repo DIR] [--cache DIR]   what /tui-review runs
    tui-review gen [--lines N] [--out DIR]                      a synthetic review cache (what /tui-review demo runs)
    tui-review bench [--repo DIR] [--base REF]                  how long a review of a real repository takes, cold and cached

Reviews are cached in `<git common dir>/tui-review/` (shared by a repo's worktrees), keyed by merge-base, HEAD and base; the five most recent are kept.

`nix develop` (or direnv) gives the Rust toolchain: cargo, clippy, rustfmt and rust-analyzer.

## Develop

    claude --plugin-dir plugins/shared/tui-review        # hot-reloads on save

    cd crates/tui-review
    cargo clippy --all-targets && cargo test && cargo bench
    cargo test --release --test perf -- --ignored --nocapture   # speed and memory budgets on a large fixture repo
    cargo run --release -- gen --out /tmp/tui-review-fixture && node ../../plugins/shared/tui-review/tests/make-fixture.mjs /tmp/tui-review-fixture
    cd .. && claude plugin test .                    # format contract, pane, speed budgets

Plugin tests have no file system, so `tests/make-fixture.mjs` turns `tui-review gen` output into `tests/fixture.gen.ts`
(not committed). The tests read the real Rust output, so they also hold the TypeScript reader to the Rust writer.
The cache layout is documented in `crates/tui-review/src/format.rs`.

tui-review ships with the repo's releases (see the main README): `npm run release` bumps `crates/tui-review/Cargo.toml`, `Cargo.lock` and
`.claude-plugin/plugin.json` with everything else (a test checks they match), and the tag's `release.yml` runs
`.github/workflows/crates-build.yml`, which builds Windows and Linux (static), x64 only. Run
`crates-build.yml` by hand to build without releasing.
