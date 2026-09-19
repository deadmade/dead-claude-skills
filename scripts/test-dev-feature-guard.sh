#!/usr/bin/env bash
# Tests for plugins/dead-skills/hooks/dev-feature-guard.sh: feeds hook JSON to it inside a throwaway git repo
# with a throwaway state dir. Needs bash, git, jq, coreutils.
set -euo pipefail
cd "$(dirname "$0")/.."
GUARD=$PWD/plugins/dead-skills/hooks/dev-feature-guard.sh

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
project=$tmp/project
git init -q "$project"
export DEV_FEATURE_STATE_DIR=$tmp/state CLAUDE_PROJECT_DIR=$project

failures=0
pass() { printf '  ok   %s\n' "$1"; }
fail() {
  printf '  FAIL %s\n       %s\n' "$1" "$2"
  failures=$((failures + 1))
}

pre_tool() { # <tool_name> <tool_input json> -> guard stdout
  jq -n --arg t "$1" --argjson i "$2" --arg c "$project" \
    '{hook_event_name: "PreToolUse", cwd: $c, tool_name: $t, tool_input: $i}' |
    (cd "$project" && bash "$GUARD" pre-tool)
}
write_to() { pre_tool Write "$(jq -n --arg p "$1" '{file_path: $p, content: "x"}')"; }
bash_cmd() { pre_tool Bash "$(jq -n --arg c "$1" '{command: $c}')"; }
prompt() {
  jq -n --arg p "$1" --arg c "$project" '{hook_event_name: "UserPromptSubmit", cwd: $c, prompt: $p}' |
    (cd "$project" && bash "$GUARD" prompt)
}

expect_allow() { # <name> <output>
  if [[ -z $2 ]]; then pass "$1"; else fail "$1" "expected allow (no output), got: $2"; fi
}
expect_deny() { # <name> <output>
  if [[ $(jq -r '.hookSpecificOutput.permissionDecision // empty' <<<"$2" 2>/dev/null) == deny ]]; then
    pass "$1"
  else
    fail "$1" "expected deny, got: ${2:-<no output>}"
  fi
}
expect_context() { # <name> <output> <substring>
  if [[ $(jq -r '.hookSpecificOutput.additionalContext // empty' <<<"$2" 2>/dev/null) == *"$3"* ]]; then
    pass "$1"
  else
    fail "$1" "expected context containing '$3', got: ${2:-<no output>}"
  fi
}

design=$project/docs/features/checkout/design.md
notes=$project/docs/features/checkout/notes.md

echo "inactive"
expect_allow "code write allowed without an active feature" "$(write_to "$project/src/app.ts")"
expect_allow "prompt adds nothing without an active feature" "$(prompt "approve design")"

echo "start"
(cd "$project" && bash "$GUARD" start checkout >/dev/null)
if (cd "$project" && bash "$GUARD" start other >/dev/null 2>&1); then
  fail "second feature refused while one is active" "start other succeeded"
else
  pass "second feature refused while one is active"
fi
if (cd "$project" && bash "$GUARD" start 'Bad Slug' >/dev/null 2>&1); then
  fail "invalid slug refused" "start 'Bad Slug' succeeded"
else
  pass "invalid slug refused"
fi
(cd "$project" && bash "$GUARD" start checkout >/dev/null) && pass "re-starting the same feature is a no-op"

echo "before approval"
expect_deny "code write denied" "$(write_to "$project/src/app.ts")"
expect_deny "relative code path denied" "$(write_to "src/app.ts")"
expect_deny "dot-dot escape into code denied" "$(write_to "$project/docs/features/../../src/app.ts")"
expect_deny "edit denied" "$(pre_tool Edit "$(jq -n --arg p "$project/src/app.ts" '{file_path: $p}')")"
expect_deny "notebook edit denied" "$(pre_tool NotebookEdit "$(jq -n --arg p "$project/n.ipynb" '{notebook_path: $p}')")"
expect_allow "design doc write allowed" "$(write_to "$design")"
expect_allow "write outside the project allowed" "$(write_to "$tmp/elsewhere.txt")"
expect_context "prompt reports the active feature" "$(prompt "what next?")" "checkout"

mkdir -p "$(dirname "$design")"
printf '# Checkout\n\n## Public methods\n- createOrder(cart: Cart): Order\n' >"$design"
printf -- '---\nphase: understanding\nverdict: not-ready\n---\n' >"$notes"
expect_context "approval refused while verdict is not-ready" "$(prompt "approve design")" "refused"
expect_deny "code still denied after refused approval" "$(write_to "$project/src/app.ts")"

echo "bash guard"
expect_deny "bash touching the state dir denied" "$(bash_cmd "rm -rf $DEV_FEATURE_STATE_DIR")"
expect_deny "bash touching ~/.claude/dev-feature denied" "$(bash_cmd 'rm -rf ~/.claude/dev-feature')"
expect_deny "bash faking a prompt to the guard denied" "$(bash_cmd "echo '{}' | bash $GUARD prompt")"
expect_allow "bash guard status allowed" "$(bash_cmd "bash $GUARD status")"
expect_allow "unrelated bash allowed" "$(bash_cmd 'git status')"

echo "approval"
printf -- '---\nphase: design\nverdict: ready\n---\n' >"$notes"
expect_context "phrase must be the whole prompt" "$(prompt "don't approve design yet")" "checkout"
expect_deny "code denied after a non-exact phrase" "$(write_to "$project/src/app.ts")"
expect_context "approval accepted when verdict is ready" "$(prompt "  Approve Design ")" "approved"
expect_allow "code write allowed after approval" "$(write_to "$project/src/app.ts")"
expect_allow "notes write allowed after approval" "$(write_to "$notes")"
status=$(cd "$project" && bash "$GUARD" status)
if [[ $status == *unlocked* ]]; then pass "status says unlocked"; else fail "status says unlocked" "$status"; fi

echo "deviation"
printf -- '- refund(order: Order): Refund\n' >>"$design"
expect_deny "code denied once design.md changes" "$(write_to "$project/src/app.ts")"
expect_context "re-approval accepted" "$(prompt "approve design")" "approved"
expect_allow "code allowed after re-approval" "$(write_to "$project/src/app.ts")"

echo "missing jq"
bin=$tmp/nojq-bin
mkdir -p "$bin"
for tool in bash git cat grep sed tr head sha256sum shasum mkdir rm dirname basename realpath cut printf; do
  path=$(command -v "$tool" 2>/dev/null) && [[ $path == /* ]] && ln -sf "$path" "$bin/$tool"
done
out=$(jq -n --arg p "$project/src/app.ts" '{tool_name: "Write", tool_input: {file_path: $p}}' | tee "$tmp/in.json" >/dev/null
  cd "$project" && PATH=$bin bash "$GUARD" pre-tool <"$tmp/in.json" || true)
if [[ $out == *jq* && $out == *deny* ]]; then
  pass "denied with a jq hint when jq is missing"
else
  fail "denied with a jq hint when jq is missing" "${out:-<no output>}"
fi

echo "done"
expect_context "feature done releases the lock" "$(prompt "feature done")" "released"
expect_allow "code write allowed after feature done" "$(write_to "$project/src/app.ts")"
(cd "$project" && bash "$GUARD" start refunds >/dev/null)
expect_context "feature abort releases the lock" "$(prompt "feature abort")" "released"
expect_allow "code write allowed after feature abort" "$(write_to "$project/src/app.ts")"

if ((failures)); then
  printf '✗ %d dev-feature guard test(s) failed\n' "$failures" >&2
  exit 1
fi
echo "✓ dev-feature guard tests passed"
