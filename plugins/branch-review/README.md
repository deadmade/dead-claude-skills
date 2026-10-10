# branch-review

`/brv` opens a diff pane beside the chat, so you can read a branch's changes and ask Claude about them in the
same session. The diff, highlighting and git work happen in `brv`, a Rust binary. The mod only paints, from small
binary chunk files `brv` writes to disk, so a 100k-line PR costs the same memory and frame time as a 100-line one.

**Status: step 1 of 4 (spike).** `/brv demo` opens a generated 100k-line review. Real branches (`/brv [base]`),
tree-sitter highlighting, quoting hunks into the prompt and "viewed" marks come next.

## Use

    /brv demo

The pane takes the keyboard when it opens. Esc goes back to the prompt to type a question; ctrl+x tab goes back to
the pane.

| Key | |
| --- | --- |
| `j` / `k`, mouse wheel | line down / up |
| `d` / `u` | page down / up |
| `n` / `p` | next / previous file |

The arrow keys don't scroll yet: the engine only forwards them while a pane has rows of its own to scroll.

The status line shows `load · paint · chunks` for the last frame.

## brv

Build it and put it on PATH, or set its path with `/plugin configure branch-review`:

    cargo build --release --manifest-path plugins/branch-review/brv/Cargo.toml

`brv gen [--lines N] [--out DIR]` writes a synthetic review cache (what `/brv demo` runs).

## Develop

    claude --plugin-dir plugins/branch-review        # hot-reloads on save

    cd plugins/branch-review/brv
    cargo clippy --all-targets && cargo test && cargo bench
    cargo run --release -- gen --out /tmp/brv-fixture && node ../tests/make-fixture.mjs /tmp/brv-fixture
    cd .. && claude plugin test .                    # format contract, pane, speed budgets

Plugin tests have no file system, so `tests/make-fixture.mjs` turns `brv gen` output into `tests/fixture.gen.ts`
(not committed). The tests read the real Rust output, so they also hold the TypeScript reader to the Rust writer.
The cache layout is documented in `brv/src/format.rs`.
