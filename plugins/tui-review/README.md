# tui-review

`/tui-review` opens a diff pane beside the chat, so you can read a branch's changes and ask Claude about them in the
same session. The diff, highlighting and git work happen in `brv`, a Rust binary. The mod only paints, from small
binary chunk files `brv` writes to disk, so a 100k-line PR costs the same memory and frame time as a 100-line one.

**Status: step 1 of 4 (spike).** `/tui-review demo` opens a generated 100k-line review. Real branches (`/tui-review [base]`),
tree-sitter highlighting and quoting hunks into the prompt come next.

## Use

    /tui-review demo

The pane docks beside the chat under Claude Code's fullscreen renderer (`/tui fullscreen`, once) in a terminal at least
110 columns wide; otherwise it opens above the prompt. It takes the keyboard when it opens. Esc goes back to the prompt to type a question; ctrl+x tab goes back to
the pane.

| Key | |
| --- | --- |
| `j` / `k`, mouse wheel | line down / up |
| `d` / `u` | page down / up |
| `n` / `p` | next / previous file |
| `v` | mark the file viewed and go to the next unviewed one; on a viewed file, clear the mark |

"Viewed" marks persist across sessions, by the file's content: a rebase that leaves a file alone keeps its mark, a
change to it clears it. The header bar counts them.

The arrow keys don't scroll yet: the engine only forwards them while a pane has rows of its own to scroll.

The status line shows `load · paint · chunks` for the last frame.

## brv

Build it and put it on PATH, or set its path with `/plugin configure tui-review`:

    cargo build --release --manifest-path plugins/tui-review/brv/Cargo.toml   # or: nix build .#brv

`nix develop` (or direnv) gives the Rust toolchain: cargo, clippy, rustfmt and rust-analyzer.

`brv gen [--lines N] [--out DIR]` writes a synthetic review cache (what `/tui-review demo` runs).

## Develop

    claude --plugin-dir plugins/tui-review        # hot-reloads on save

    cd plugins/tui-review/brv
    cargo clippy --all-targets && cargo test && cargo bench
    cargo run --release -- gen --out /tmp/brv-fixture && node ../tests/make-fixture.mjs /tmp/brv-fixture
    cd .. && claude plugin test .                    # format contract, pane, speed budgets

Plugin tests have no file system, so `tests/make-fixture.mjs` turns `brv gen` output into `tests/fixture.gen.ts`
(not committed). The tests read the real Rust output, so they also hold the TypeScript reader to the Rust writer.
The cache layout is documented in `brv/src/format.rs`.
