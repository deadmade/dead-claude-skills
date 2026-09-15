#!/usr/bin/env bash
# Vendor graphify's Claude Code skill (bash variant + references/ sidecar) into plugins/graphify/skills/graphify/.
# Upstream isn't a Claude Code plugin: `graphify install` copies these files into ~/.claude/skills. The plugin's
# hooks/hooks.json is hand-written and not touched here. Idempotent: re-running against the same commit gives no diff.
set -euo pipefail

UPSTREAM_URL="https://github.com/Graphify-Labs/graphify.git"
REFERENCES=(add-watch exports extraction-spec github-and-merge hooks query transcribe update)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$ROOT/plugins/graphify"
DEST="$PLUGIN/skills/graphify"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet --depth 1 --filter=blob:none --sparse "$UPSTREAM_URL" "$TMP/graphify"
git -C "$TMP/graphify" sparse-checkout set --no-cone /graphify/skill.md /graphify/skills/claude/references/ /LICENSE /LICENSE-MIT /NOTICE

SRC="$TMP/graphify/graphify"
[ -f "$SRC/skill.md" ] || { echo "error: upstream graphify/skill.md not found (renamed or removed?)" >&2; exit 1; }
for r in "${REFERENCES[@]}"; do
  [ -f "$SRC/skills/claude/references/$r.md" ] || { echo "error: upstream graphify/skills/claude/references/$r.md not found" >&2; exit 1; }
done

rm -rf "$PLUGIN/skills"
mkdir -p "$DEST"
cp "$SRC/skill.md" "$DEST/SKILL.md"
cp -R "$SRC/skills/claude/references" "$DEST/references"
cp "$TMP/graphify/LICENSE" "$TMP/graphify/LICENSE-MIT" "$TMP/graphify/NOTICE" "$PLUGIN/"

SHA="$(git -C "$TMP/graphify" rev-parse HEAD)"
echo "$SHA" > "$PLUGIN/UPSTREAM"

if [ -n "$(git -C "$ROOT" status --porcelain -- "$PLUGIN" 2>/dev/null)" ]; then
  echo "graphify synced to $SHA (changed)"
else
  echo "graphify already at $SHA (no changes)"
fi
