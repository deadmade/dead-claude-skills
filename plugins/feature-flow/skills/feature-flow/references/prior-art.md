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
Return the report as markdown, under 800 words.
```

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
+ <what it's good at here>
− <what it costs here>
Effort: S | M | L

**B – …**

→ Recommendation: B, because <one sentence tied to this codebase or the user's goals>.
```
