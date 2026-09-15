#!/usr/bin/env bash
# Vendor a curated subset of Cursor's pstack (cursor/plugins/pstack) into plugins/pstack-picks/,
# rewrite its Cursor-specific instructions for Claude Code (scripts/pstack-rewrites.pl), and refuse
# to publish if any Cursor-ism survives. Idempotent: same upstream commit, same output.
set -euo pipefail

UPSTREAM_URL="https://github.com/cursor/plugins.git"
SKILLS=(
  how why recall bro interrogate blast-radius no-comments unslop technical-writing architect arena swarm
  show-me-your-work
  principle-separate-before-serializing-shared-state
  principle-redesign-from-first-principles
  principle-prove-it-works
  principle-fix-root-causes
  principle-type-system-discipline
  principle-boundary-discipline
  principle-model-the-domain
  principle-make-operations-idempotent
)
AGENTS=(comment-sicko)
# Upstream skills deliberately not vendored. Anything in neither list is reported as new.
SKIPPED=(
  automate-me create-verification-skill figure-it-out maintain-verification-skill make-bot-ui poteto-mode
  reflect setup-pstack tdd teach typescript-best-practices
  principle-attack-the-premise principle-build-the-lever principle-encode-lessons-in-structure
  principle-exhaust-the-design-space principle-experience-first principle-foundational-thinking
  principle-guard-the-context-window principle-laziness-protocol principle-migrate-callers-then-delete-legacy-apis
  principle-minimize-reader-load principle-never-block-on-the-human principle-outcome-oriented-execution
  principle-sequence-verifiable-units principle-subtract-before-you-add principle-test-behavior-not-implementation
)
# Cursor-isms that must not survive the rewrite (case-sensitive; "cursor location" in prose is fine).
GUARD='\.cursor|Cursor|\bTask\b|AskQuestion|generalPurpose|[Rr]eadonly|environment: "|cloud_base_branch|agent-transcripts|mcps/|todolist|grok-|gpt-5|sol-max|-thinking-|pstack-models|subagent_type: "Comment Sicko"|^name: Comment Sicko'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$ROOT/plugins/pstack-picks"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet --depth 1 --filter=blob:none --sparse "$UPSTREAM_URL" "$TMP/up"
patterns=(/pstack/LICENSE)
for s in "${SKILLS[@]}"; do patterns+=("/pstack/skills/$s/"); done
for a in "${AGENTS[@]}"; do patterns+=("/pstack/agents/$a.md"); done
git -C "$TMP/up" sparse-checkout set --no-cone "${patterns[@]}"
UP="$TMP/up/pstack"

for s in "${SKILLS[@]}"; do
  [ -f "$UP/skills/$s/SKILL.md" ] || { echo "error: upstream pstack/skills/$s/SKILL.md not found (renamed or removed?)" >&2; exit 1; }
done
for a in "${AGENTS[@]}"; do
  [ -f "$UP/agents/$a.md" ] || { echo "error: upstream pstack/agents/$a.md not found" >&2; exit 1; }
done

# New upstream skills: every directory under pstack/skills that is neither vendored nor skipped.
known=" ${SKILLS[*]} ${SKIPPED[*]} "
NEW=()
while IFS= read -r d; do
  s="${d##*/}"
  if [[ "$known" != *" $s "* ]]; then NEW+=("$s"); fi
done < <(git -C "$TMP/up" ls-tree -d --name-only HEAD pstack/skills/)
if [ ${#NEW[@]} -gt 0 ]; then
  for s in "${NEW[@]}"; do git -C "$TMP/up" sparse-checkout add "/pstack/skills/$s/"; done
  for s in "${NEW[@]}"; do
    desc="$(awk '/^description:/ { sub(/^description:[[:space:]]*/, ""); gsub(/^"|"$/, ""); print; exit }' "$UP/skills/$s/SKILL.md" 2>/dev/null || true)"
    echo "new upstream skill (not in SKILLS or SKIPPED): $s: $desc"
    if [ -n "${NEW_SKILLS_FILE:-}" ]; then printf '%s\t%s\n' "$s" "$desc" >> "$NEW_SKILLS_FILE"; fi
  done
fi

# Build into a staging dir, rewrite, guard, then swap in.
STAGE="$TMP/stage"
mkdir -p "$STAGE/skills" "$STAGE/agents" "$STAGE/.claude-plugin"
for s in "${SKILLS[@]}"; do cp -R "$UP/skills/$s" "$STAGE/skills/$s"; done
for a in "${AGENTS[@]}"; do cp "$UP/agents/$a.md" "$STAGE/agents/$a.md"; done
cp "$UP/LICENSE" "$STAGE/LICENSE"
cp "$PLUGIN/.claude-plugin/plugin.json" "$STAGE/.claude-plugin/plugin.json"

find "$STAGE/skills" "$STAGE/agents" -name '*.md' -print0 | xargs -0 perl -0777 -pi "$ROOT/scripts/pstack-rewrites.pl"

if leftovers="$(grep -rnE "$GUARD" "$STAGE/skills" "$STAGE/agents")"; then
  echo "error: Cursor-specific text survived the rewrite; add a rule to scripts/pstack-rewrites.pl:" >&2
  # shellcheck disable=SC2001  # per-line prefix strip on multi-line grep output
  echo "$leftovers" | sed "s|$STAGE/||" >&2
  exit 1
fi

SHA="$(git -C "$TMP/up" rev-parse HEAD)"
echo "$SHA" > "$STAGE/UPSTREAM"

rm -rf "$PLUGIN/skills" "$PLUGIN/agents" "$PLUGIN/LICENSE" "$PLUGIN/UPSTREAM"
cp -R "$STAGE/skills" "$STAGE/agents" "$STAGE/LICENSE" "$STAGE/UPSTREAM" "$PLUGIN/"

if [ -n "$(git -C "$ROOT" status --porcelain -- "$PLUGIN" 2>/dev/null)" ]; then
  echo "pstack-picks synced to $SHA (changed)"
else
  echo "pstack-picks already at $SHA (no changes)"
fi
