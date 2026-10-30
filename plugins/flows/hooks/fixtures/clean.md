> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or

    - URL
    - `ALL: [Engine; 6]`

- [ ] **Step 2: Run `cargo test engines`.** Expect: FAIL (the module is missing).
- [ ] **Step 4: Run `cargo test engines`, then `cargo clippy --all-targets -- -D warnings`.** Expect: PASS.
      Expected: PASS, 10 tests.

3. Capitals that aren't abbreviations in real docs (PASS, FAIL, HEAD, `SKILL.md`, NOT, MB) and definitions in a table

- `real docs stay clean`: `check` over `fixtures/clean.md` gives no `undefined` finding. The fixture holds real lines
  from `docs/features/web-mcp-search/plan.md` and this plan with "Expected: PASS", "FAIL", `SKILL.md` outside code
  font, "git HEAD", "do NOT", "50 MB" and "PNG".

1. **Upstream layout drift.** A skill folder without SKILL.md, or a frontmatter `name` that doesn't match its folder.
2. **Huge or non-text responses** (a 50 MB HTML page, a `.zip` URL). Expected: download capped at 20 MB; a content type
