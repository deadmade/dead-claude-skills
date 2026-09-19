#!/usr/bin/env bash
# dev-feature lock. Hook entry points: `pre-tool` (PreToolUse) and `prompt` (UserPromptSubmit).
# Skill entry points: `start <slug>` and `status`.
#
# While a feature is active for a repo, file edits inside the repo are denied (except docs/features/) until the
# user types exactly "approve design" and design.md still hashes to what was approved. Only the user's own prompt
# can approve or release the lock. This stops drift, not a deliberate bypass: Bash file writes aren't inspected.
set -uo pipefail

STATE_DIR=${DEV_FEATURE_STATE_DIR:-$HOME/.claude/dev-feature}

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi
}

project_root() {
  local dir=${CLAUDE_PROJECT_DIR:-$PWD}
  git -C "$dir" rev-parse --show-toplevel 2>/dev/null || printf '%s\n' "$dir"
}

state_file() { # <root>
  printf '%s/%s.json' "$STATE_DIR" "$(printf '%s' "$1" | sha | cut -c1-16)"
}

# Comparable path: forward slashes; on Windows lowercase and /c/... → c:/...
norm() {
  local p=${1//\\//}
  if [[ ${OSTYPE:-} == msys* || ${OSTYPE:-} == cygwin* || $p =~ ^[A-Za-z]: ]]; then
    [[ $p =~ ^/([A-Za-z])/(.*)$ ]] && p="${BASH_REMATCH[1]}:/${BASH_REMATCH[2]}"
    p=${p,,}
  fi
  printf '%s' "${p%/}"
}

any_state() {
  shopt -s nullglob
  local files=("$STATE_DIR"/*.json)
  ((${#files[@]}))
}

deny() { # <reason>
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg r "$1" \
      '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  else
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  fi
  exit 0
}

context() { # <context for Claude> [message shown to the user]
  jq -n --arg c "$1" --arg u "${2-}" \
    '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $c}}
     + (if $u == "" then {} else {systemMessage: $u} end)'
  exit 0
}

design_sha() { # <root> <slug>
  local design=$1/docs/features/$2/design.md
  [[ -f $design ]] && sha <"$design"
}

pre_tool() {
  any_state || exit 0
  local root state
  root=$(project_root)
  state=$(state_file "$root")
  [[ -f $state ]] || exit 0
  command -v jq >/dev/null 2>&1 || deny "dev-feature is active in this repo but jq is not installed. Ask the user to install jq."

  local input tool slug approved
  input=$(cat)
  tool=$(jq -r '.tool_name // ""' <<<"$input")
  slug=$(jq -r '.slug' "$state")
  approved=$(jq -r '.approved_sha // ""' "$state")

  case $tool in
    Bash)
      local cmd rest
      cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
      rest=$cmd
      while [[ $rest == *dev-feature-guard.sh* ]]; do
        rest=${rest#*dev-feature-guard.sh}
        [[ $rest =~ ^[\"\']?[[:space:]]+(start|status)([[:space:]]|$) ]] ||
          deny "dev-feature: only 'dev-feature-guard.sh start|status' may be run. Approval and release come from the user's own prompt."
      done
      if [[ $cmd == *"$STATE_DIR"* || $cmd == *.claude/dev-feature* || $cmd == *approved_sha* ]]; then
        deny "dev-feature: the lock state belongs to the user. Don't read around or change it; ask the user."
      fi
      exit 0
      ;;
    Write | Edit | MultiEdit | NotebookEdit) ;;
    *) exit 0 ;;
  esac

  local path cwd nroot nproj rel=""
  path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' <<<"$input")
  [[ -n $path ]] || exit 0
  cwd=$(jq -r '.cwd // ""' <<<"$input")
  path=$(norm "$path")
  [[ $path == /* || $path =~ ^[a-z]:/ ]] || path=$(norm "${cwd:-$PWD}")/$path
  [[ /$path/ == */../* ]] && deny "dev-feature: paths with '..' are not allowed while the design is locked. Use the absolute path."

  nroot=$(norm "$root")
  nproj=$(norm "${CLAUDE_PROJECT_DIR:-$root}")
  if [[ $path == "$nroot"/* ]]; then
    rel=${path#"$nroot"/}
  elif [[ $path == "$nproj"/* ]]; then
    rel=${path#"$nproj"/}
  else
    exit 0
  fi
  [[ $rel == docs/features/* ]] && exit 0

  if [[ -z $approved ]]; then
    deny "dev-feature '$slug': the design is not approved, so code in this repo is locked. Only docs/features/$slug/ may be edited. Continue the dev-feature phases; the user unlocks code by typing exactly: approve design. Don't work around this lock (no file writes through Bash)."
  fi
  if [[ $(design_sha "$root" "$slug") != "$approved" ]]; then
    deny "dev-feature '$slug': design.md changed since the user approved it, so code is locked again. Record the deviation in notes.md, grill the user on the change, then ask them to type: approve design."
  fi
  exit 0
}

frontmatter_value() { # <file> <key>
  [[ -f $1 ]] || return 0
  awk -v key="$2" 'NR == 1 && $0 != "---" { exit } NR > 1 && $0 == "---" { exit }
    index($0, key ":") == 1 { sub("^" key ":[[:space:]]*", ""); sub("[[:space:]]+$", ""); print; exit }' "$1"
}

prompt_hook() {
  any_state || exit 0
  local root state
  root=$(project_root)
  state=$(state_file "$root")
  [[ -f $state ]] || exit 0
  command -v jq >/dev/null 2>&1 || exit 0

  local text slug approved verdict current
  text=$(jq -r '.prompt // ""' | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ')
  text=${text# }
  text=${text% }
  slug=$(jq -r '.slug' "$state")
  approved=$(jq -r '.approved_sha // ""' "$state")

  case $text in
    "approve design")
      current=$(design_sha "$root" "$slug")
      [[ -n $current ]] ||
        context "dev-feature '$slug': approval refused, docs/features/$slug/design.md does not exist." \
          "dev-feature: approval refused, design.md does not exist"
      verdict=$(frontmatter_value "$root/docs/features/$slug/notes.md" verdict)
      [[ $verdict == ready ]] ||
        context "dev-feature '$slug': approval refused, the verdict in notes.md is '${verdict:-missing}', not 'ready'. There is no override: the user must pass the understanding grill first." \
          "dev-feature: approval refused, verdict is not ready"
      jq --arg s "$current" '.approved_sha = $s' "$state" >"$state.tmp" && mv "$state.tmp" "$state"
      context "dev-feature '$slug': the user approved design.md (sha256 ${current:0:12}). Code is unlocked. Implement against the design; any edit to design.md locks code again until the user re-approves." \
        "dev-feature: design approved, implementation unlocked"
      ;;
    "feature done" | "feature abort")
      rm -f "$state"
      context "dev-feature '$slug': the user released the lock (${text#feature })." \
        "dev-feature: '$slug' released (${text#feature })"
      ;;
  esac

  if [[ -z $approved ]]; then
    context "dev-feature '$slug' is active in this repo; code is locked (design not approved). State: docs/features/$slug/notes.md."
  elif [[ $(design_sha "$root" "$slug") != "$approved" ]]; then
    context "dev-feature '$slug' is active; code is locked because design.md changed since approval. State: docs/features/$slug/notes.md."
  fi
  context "dev-feature '$slug' is active; code is unlocked against the approved design. State: docs/features/$slug/notes.md."
}

start() { # <slug>
  local slug=${1-} root state existing
  [[ $slug =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "slug must be lowercase kebab-case, got '$slug'"
  command -v jq >/dev/null 2>&1 || die "dev-feature needs jq; ask the user to install it"
  root=$(project_root)
  state=$(state_file "$root")
  mkdir -p "$STATE_DIR"
  if [[ -f $state ]]; then
    existing=$(jq -r '.slug' "$state")
    if [[ $existing == "$slug" ]]; then
      echo "dev-feature '$slug' is already active in $root (resuming)"
      exit 0
    fi
    die "dev-feature '$existing' is still active in $root; the user must type 'feature done' or 'feature abort' first"
  fi
  jq -n --arg r "$root" --arg s "$slug" '{root: $r, slug: $s, approved_sha: ""}' >"$state"
  echo "dev-feature '$slug' started in $root: code is locked until the user types 'approve design'"
}

status() {
  local root state slug approved
  root=$(project_root)
  state=$(state_file "$root")
  [[ -f $state ]] || {
    echo "no active dev-feature in $root"
    exit 0
  }
  command -v jq >/dev/null 2>&1 || die "dev-feature needs jq; ask the user to install it"
  slug=$(jq -r '.slug' "$state")
  approved=$(jq -r '.approved_sha // ""' "$state")
  if [[ -z $approved ]]; then
    echo "dev-feature '$slug': locked, design not approved yet"
  elif [[ $(design_sha "$root" "$slug") != "$approved" ]]; then
    echo "dev-feature '$slug': locked, design.md changed since approval"
  else
    echo "dev-feature '$slug': unlocked, design approved"
  fi
}

case ${1-} in
  pre-tool) pre_tool ;;
  prompt) prompt_hook ;;
  start) start "${2-}" ;;
  status) status ;;
  *) die "usage: dev-feature-guard.sh pre-tool|prompt|start <slug>|status" ;;
esac
