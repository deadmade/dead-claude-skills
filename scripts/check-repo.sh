#!/usr/bin/env bash
# Repo checks for the pre-commit hook: every plugin manifest validates, and the marketplace, the dead-skills
# bundle and the setup scripts agree on the plugin list. Needs jq. Skips `claude plugin validate` when claude
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

# --- setup scripts: every marketplace plugin is either a bundle dependency or an opt-in ---
read -ra sh_optins <<<"$(sed -n 's/^OPTINS=(\(.*\))$/\1/p' setup.sh)"
mapfile -t ps_optins < <(
  awk '/^[$]OptIns = [[]ordered[]]@[{]/ {f = 1; next} f && /^[}]/ {f = 0} f' setup.ps1 |
    grep -oE "^ *'[a-z0-9-]+'" | tr -d " '" | sort
)

expected=$(printf '%s\n' dead-skills "${deps[@]}" "${sh_optins[@]}" | sort)
actual=$(printf '%s\n' "${market[@]}")
if [[ $expected != "$actual" ]]; then
  fail "setup.sh OPTINS + $BUNDLE dependencies don't match $MARKETPLACE (< setup/bundle, > marketplace): $(
    diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") | grep '^[<>]' | tr '\n' ' ' || true
  )"
fi

if [[ $(printf '%s\n' "${sh_optins[@]}" | sort) != "$(printf '%s\n' "${ps_optins[@]}")" ]]; then
  fail "setup.ps1 \$OptIns (${ps_optins[*]}) differs from setup.sh OPTINS (${sh_optins[*]})"
fi

if ((${#problems[@]})); then
  printf '✗ %s\n' "${problems[@]}" >&2
  exit 1
fi
echo "✓ repo checks passed"
