#!/usr/bin/env bash
# Repo checks for the pre-commit hook: every plugin manifest validates, and the marketplace and the dead-skills
# bundle agree on the plugin list. Needs jq. Skips `claude plugin validate` when claude
# isn't on PATH (nix flake check sandbox, CI).
set -euo pipefail
cd "$(dirname "$0")/.."

MARKETPLACE=.claude-plugin/marketplace.json
BUNDLE=plugins/dead-skills/.claude-plugin/plugin.json
problems=()
fail() { problems+=("$*"); }

# --- claude plugin validate (warnings such as a missing version are fine) ---
if command -v claude >/dev/null 2>&1; then
  for target in . plugins/*/; do
    if ! out=$(claude plugin validate "$target" 2>&1); then
      fail "claude plugin validate $target failed:"$'\n'"$out"
    fi
  done
else
  echo "claude not on PATH: skipping claude plugin validate"
fi

# --- marketplace <-> bundle <-> plugins/ ---
mapfile -t market < <(jq -r '.plugins[].name' "$MARKETPLACE" | sort)
mapfile -t deps < <(jq -r '.dependencies[]' "$BUNDLE" | sort)

for dep in "${deps[@]}"; do
  printf '%s\n' "${market[@]}" | grep -qxF "$dep" || fail "$BUNDLE: dependency $dep is not in $MARKETPLACE"
done

while IFS= read -r src; do
  [[ -f $src/.claude-plugin/plugin.json ]] || fail "$MARKETPLACE: $src has no .claude-plugin/plugin.json"
done < <(jq -r '.plugins[].source | strings' "$MARKETPLACE")

for dir in plugins/*/; do
  dir=${dir%/}
  jq -e --arg s "./$dir" 'any(.plugins[]; .source == $s)' "$MARKETPLACE" >/dev/null ||
    fail "$dir is not listed in $MARKETPLACE"
done

if ((${#problems[@]})); then
  printf '✗ %s\n' "${problems[@]}" >&2
  exit 1
fi
echo "✓ repo checks passed"
