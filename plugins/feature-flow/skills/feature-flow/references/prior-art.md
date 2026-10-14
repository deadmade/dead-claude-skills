# Prior art

How other projects solve the same problem, so the options in Phase 2 are real shapes with real trade-offs, not
inventions.

## Agent prompt

Launch one `general-purpose` agent in the background with this prompt, filled in:

```
Research how other projects implement: <feature, in one paragraph>.
This codebase: <language, framework, the libraries it already uses with versions from the lockfile/manifest,
the subsystem it touches>.

Find:
1. 3–5 comparable implementations: well-known open-source projects, framework built-ins or libraries that do
   this. For each: what shape they chose (data model, where the logic lives, sync vs async, …), the one or two
   decisions that matter, and a link to the code or docs (file or section, not the repo root).
2. The official docs of every library, API or protocol involved, at the version this codebase uses (context7 MCP
   tools if available: resolve the library id, then query; otherwise WebFetch). The sections that constrain the
   design: limits, retries, idempotency, auth, ordering, deprecations.
3. Known pitfalls: issues, postmortems or maintainer notes on how this goes wrong.

Group the implementations into 2–4 distinct approaches. For each approach: the shape in two lines, who uses it,
what it's good at, what it costs, and what would make it a bad fit.

Rules: cite only pages you actually fetched in this run, with a link to the section and one line on what it says.
Never cite from memory and never construct a URL you didn't open. Prefer official docs and source code over blog
posts; label blog posts as such. If you find nothing comparable, say so instead of padding.
Mark every trade-off and "bad fit" claim [source] (a page says it; link it) or [inferred] (your reasoning across
sources). Never present an inference as what a source says.
Write the report as markdown, under 800 words, to <report path>. Start it with what you couldn't research (a page
that wouldn't open, docs for another version only), or "Gaps: none". Reply with the path, or with the report if
you can't write files.
```

## Source check

Research agents misquote sources, cite a page that doesn't say it, or read docs for the wrong version. Once the
report lands, give one fresh agent, on a different model where available (the Agent tool's `model`), only the
report file and the codebase facts from the prompt above, with this prompt:

```
Check this prior-art report against its sources. Open every link it cites, at the version named. For each claim
marked [source]: confirmed (the page says it), not supported (quote what the page says instead), or couldn't open.
For each [inferred] claim an approach's trade-offs rest on: does it follow from the cited pages? List the claims
that cite nothing. Don't add research of your own and don't rewrite the report. Return a table: claim, verdict,
evidence.
```

Then fix the report yourself: drop or relabel every claim that isn't supported, mark unopened sources, and note the
counts (confirmed / not supported / couldn't open) at its top. An approach whose case rests on unsupported claims
is presented in Phase 2 as unverified, or not at all.

## Source rules

- Fetched in this session or it doesn't get cited: WebSearch/WebFetch, context7, GitHub, files in the repo.
- Match the version the repo uses when docs are versioned.
- Link to the section; code facts are `file:line` or a permalink.
- Priority: official docs and specs → maintainer guides and examples → established references (MDN, OWASP, the
  language's docs) → blog posts, labelled.

## Options format (Phase 2, and per finding in Phase 5)

```
**A – <name>** (used by: <project> [link], <project> [link])
<shape in two lines>
+ <what it's good at here> (verified: [link] | inferred)
− <what it costs here> (verified: [link] | inferred)
Effort: S | M | L

**B – …**

→ Recommendation: B, because <one sentence tied to this codebase or the user's goals>.
```
