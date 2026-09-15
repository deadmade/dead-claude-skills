#!/usr/bin/env bash
# Vendor nutlope/hallmark's skill into dead-skills and scope it to web files via `paths:`.
# Idempotent: re-running against the same upstream commit produces no diff.
set -euo pipefail

UPSTREAM_URL="https://github.com/nutlope/hallmark.git"
# Prefixed to the description to keep the skill out of non-web work. Must not contain double quotes
# (it lands inside a double-quoted YAML string). `paths:` frontmatter would be the cleaner fix, but
# Claude Code ignores it for plugin skills (verified on 2.1.272; it only works for project skills).
SCOPE='WEB FRONTEND ONLY: use solely for browser UI work (HTML/CSS, React/Vue/Svelte/Astro pages and components); never for CLIs, backends, libraries, or non-web apps (e.g. Rust, Python, Go), even when asked for a new app.'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/plugins/dead-skills/skills/hallmark"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet --depth 1 --filter=blob:none --sparse "$UPSTREAM_URL" "$TMP/hallmark"
git -C "$TMP/hallmark" sparse-checkout set skills/hallmark
SRC="$TMP/hallmark/skills/hallmark"
[ -f "$SRC/SKILL.md" ] || { echo "error: upstream skills/hallmark/SKILL.md not found" >&2; exit 1; }

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
cp "$TMP/hallmark/LICENSE" "$DEST/LICENSE"

# In the first frontmatter block (which must name the skill `hallmark`): prefix the description with SCOPE.
awk -v scope="$SCOPE" '
  NR == 1 { if ($0 != "---") exit 2; infm = 1; print; next }
  infm && $0 == "---" { infm = 0; if (!named || !described) exit 3; print; next }
  infm && /^name:[[:space:]]*hallmark[[:space:]]*$/ { print; named = 1; next }
  infm && /^description:[[:space:]]*"/ { sub(/^description:[[:space:]]*"/, "description: \"" scope " "); print; described = 1; next }
  infm && /^description:[[:space:]]*[^"|>[:space:]]/ {
    v = $0; sub(/^description:[[:space:]]*/, "", v); gsub(/"/, "\\\"", v)
    print "description: \"" scope " " v "\""; described = 1; next
  }
  { print }
  END { if (infm) exit 2 }
' "$DEST/SKILL.md" > "$TMP/SKILL.md" || {
  echo "error: unexpected SKILL.md frontmatter upstream (missing --- block or 'name: hallmark')" >&2
  exit 1
}
mv "$TMP/SKILL.md" "$DEST/SKILL.md"

SHA="$(git -C "$TMP/hallmark" rev-parse HEAD)"
echo "$SHA" > "$DEST/UPSTREAM"

if [ -n "$(git -C "$ROOT" status --porcelain -- "$DEST" 2>/dev/null)" ]; then
  echo "hallmark synced to $SHA (changed)"
else
  echo "hallmark already at $SHA (no changes)"
fi
