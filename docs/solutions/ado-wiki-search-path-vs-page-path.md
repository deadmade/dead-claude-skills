# ado-mcp: a wiki search hit's path gives "not found: page …" in the wiki tool

- **Seen:** 2026-10-28, feature ado-mcp-next, Tasks 2 and 4. Wiki Search's `path` (`/Runbooks/Deploy.md`) is not
  what Pages - Get Page takes (`/Runbooks/Deploy`).
- **Cause:** Search returns the wiki's git file path. That path ends in `.md`, writes a space as `-` and a literal
  `-` as `%2D` (other reserved characters percent-encoded too), and for a code wiki starts with the folder it is
  published from (`wiki.mappedPath`). The page API takes the page path relative to the wiki root.
- **Fix:** `search::page_path` (`crates/ado-mcp/src/search.rs:160`) cuts the mapped folder (any case, only when followed
  by `/`) and `.md`, turns `-` into a space, then percent-decodes. A path that won't decode as UTF-8 stays raw.
  Commits fb0ad4b and 50bb8b9.
- **Spot it next time:** when one tool's output is meant as another's input, test the round trip. The mapped-folder
  part rests on the docs' wording only (the 7.1 sample is root-mapped); the smoke checklist opens a hit from a code
  wiki published from a subfolder.
