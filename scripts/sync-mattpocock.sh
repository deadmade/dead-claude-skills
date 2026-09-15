#!/usr/bin/env bash
# Vendor a curated subset of mattpocock/skills into plugins/mattpocock-picks/skills/<name>/.
# A strict:false marketplace entry can't narrow it: upstream's plugin.json already lists skills,
# and Claude Code refuses to load a plugin whose manifest and marketplace entry both specify components.
# Idempotent: re-running against the same upstream commit produces no diff.
set -euo pipefail

UPSTREAM_URL="https://github.com/mattpocock/skills.git"
SKILLS=(
  engineering/grill-with-docs
  engineering/to-spec
  engineering/to-tickets
  engineering/improve-codebase-architecture
  engineering/setup-matt-pocock-skills
  engineering/domain-modeling
  engineering/codebase-design
  productivity/grill-me
  productivity/grilling
  productivity/handoff
  productivity/teach
  productivity/to-questionnaire
  productivity/wait-what
  productivity/writing-for-agents
)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$ROOT/plugins/mattpocock-picks"
DEST="$PLUGIN/skills"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet --depth 1 --filter=blob:none --sparse "$UPSTREAM_URL" "$TMP/skills"
git -C "$TMP/skills" sparse-checkout set "${SKILLS[@]/#/skills/}"

for s in "${SKILLS[@]}"; do
  [ -f "$TMP/skills/skills/$s/SKILL.md" ] || { echo "error: upstream skills/$s/SKILL.md not found (renamed or removed?)" >&2; exit 1; }
done

rm -rf "$DEST"
mkdir -p "$DEST"
for s in "${SKILLS[@]}"; do
  cp -R "$TMP/skills/skills/$s" "$DEST/${s##*/}"
done
cp "$TMP/skills/LICENSE" "$PLUGIN/LICENSE"

SHA="$(git -C "$TMP/skills" rev-parse HEAD)"
echo "$SHA" > "$PLUGIN/UPSTREAM"

if [ -n "$(git -C "$ROOT" status --porcelain -- "$PLUGIN" 2>/dev/null)" ]; then
  echo "mattpocock-picks synced to $SHA (changed)"
else
  echo "mattpocock-picks already at $SHA (no changes)"
fi
