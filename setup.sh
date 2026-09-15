#!/usr/bin/env bash
# Set up dead-claude-skills on this machine: marketplace, plugins, user settings, external tools.
# Safe to re-run. On Linux/macOS external tools are only reported, never installed (Windows: setup.ps1).
# Needs bash 4+.
set -euo pipefail

MARKET=dead-claude-skills
REPO=deadmade/dead-claude-skills
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
PERM='Read(~/.claude/plugins/**)'
# dead-skills and its dependencies (plugins/dead-skills/.claude-plugin/plugin.json)
BUNDLE=(dead-skills code-review skill-creator claude-code-setup superpowers ponytail
  rust-analyzer-lsp csharp-lsp typescript-lsp pyright-lsp nix-lsp mcp-basic)
OPTINS=(mcp-github mcp-azure mattpocock-picks pstack-picks graphify)
declare -A DESC=(
  [mcp-github]="GitHub's hosted MCP server (needs a fine-grained PAT)"
  [mcp-azure]="Azure DevOps Server MCP server (needs collection URL + PAT, Node 20+)"
  [mattpocock-picks]="curated Matt Pocock skills (grilling, spec to tickets, architecture)"
  [pstack-picks]="curated pstack skills (how/why, review, unslop, architect/arena/swarm)"
  [graphify]="codebase knowledge graph (needs the graphify CLI)"
)

usage() {
  cat <<EOF
Usage: ./setup.sh [options]

Adds the $MARKET marketplace, installs dead-skills, asks for each opt-in plugin,
adds the $PERM permission and marketplace auto-update to $SETTINGS,
and reports missing external tools.

  --all           install every opt-in (${OPTINS[*]})
  --work          install mcp-azure and mcp-github
  --with a,b      install these opt-ins
  -y, --yes       no prompts (opt-ins only via --all/--work/--with)
  --no-tools      skip the external tool check
  -n, --dry-run   print commands instead of running them
  -h, --help      show this help

PATs for --yes runs: GITHUB_PAT, ADO_ORG_URL, ADO_PAT, ADO_API_VERSION, ADO_DEFAULT_PROJECT.
EOF
}

INSTALLED=() MISSING=() WARNINGS=()
say()  { printf '%s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; WARNINGS+=("$*"); }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }

# Runs a command, or prints it with --dry-run. PAT values are masked when printed.
run() {
  local shown=() a
  for a in "$@"; do
    if [[ $a == *_pat=* ]]; then a="${a%%=*}=***"; fi
    shown+=("$a")
  done
  if ((DRY)); then printf '  $ %s\n' "${shown[*]}"; else "$@"; fi
}

ask() {
  local reply
  read -r -p "  $1 [y/N] " reply
  [[ $reply == [yY]* ]]
}

secret() {
  local value
  read -r -s -p "  $1: " value
  printf '\n' >&2
  printf '%s' "$value"
}

YES=0 DRY=0 TOOLS=1 PICKED=0
declare -A SEL=()
pick() {
  local list o
  IFS=, read -ra list <<<"$1"
  for o in "${list[@]}"; do
    [[ -v DESC[$o] ]] || die "unknown opt-in: $o (choose from ${OPTINS[*]})"
    SEL[$o]=1
  done
  PICKED=1
}
while (($#)); do
  case $1 in
    --all) pick "$(IFS=,; echo "${OPTINS[*]}")" ;;
    --work) pick mcp-azure,mcp-github ;;
    --with) (($# >= 2)) || die "--with needs a comma-separated list"; pick "$2"; shift ;;
    --with=*) pick "${1#--with=}" ;;
    -y|--yes) YES=1 ;;
    --no-tools) TOOLS=0 ;;
    -n|--dry-run) DRY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done
if ! [[ -t 0 ]]; then YES=1; fi

has claude || die "claude not found on PATH; install Claude Code first"
if [[ -e /etc/NIXOS ]]; then OS=nixos
elif [[ $(uname -s) == Darwin ]]; then OS=macos
else OS=linux
fi

PLUGINS=
refresh() { PLUGINS=$(claude plugin list --json); }
installed() { grep -Eq "\"id\": *\"$1@$MARKET\"" <<<"$PLUGINS"; }
wants() { [[ -n ${SEL[$1]:-} ]] || installed "$1"; }

install() {  # install <name> [--config key=value ...]
  local name=$1
  shift
  say "  → $name"
  if run claude plugin install "$name@$MARKET" "$@"; then INSTALLED+=("$name"); else warn "installing $name failed"; fi
}

# --- opt-ins ---------------------------------------------------------------
refresh
say "==> Opt-in plugins"
for o in "${OPTINS[@]}"; do
  if installed "$o"; then
    ok "$o already installed"
  elif ((!PICKED && !YES)); then
    if ask "$o: ${DESC[$o]}?"; then SEL[$o]=1; fi
  fi
done

# --- marketplace -----------------------------------------------------------
say "==> Marketplace"
markets=$(claude plugin marketplace list --json)
if grep -Eq "\"name\": *\"$MARKET\"" <<<"$markets"; then
  run claude plugin marketplace update "$MARKET"
else
  run claude plugin marketplace add "$REPO"
fi

# --- plugins ---------------------------------------------------------------
say "==> Plugins"
if installed dead-skills; then ok "dead-skills already installed"; else install dead-skills; fi

for o in mattpocock-picks pstack-picks graphify; do
  if [[ -n ${SEL[$o]:-} ]] && ! installed "$o"; then install "$o"; fi
done

if [[ -n ${SEL[mcp-github]:-} ]] && ! installed mcp-github; then
  pat=${GITHUB_PAT:-}
  if ((DRY)); then pat='<pat>'
  elif [[ -z $pat ]] && ((!YES)); then pat=$(secret "GitHub PAT (fine-grained)")
  fi
  if [[ -z $pat ]]; then
    warn "mcp-github skipped: no PAT (set GITHUB_PAT or run interactively)"
  else
    install mcp-github --config "github_pat=$pat"
  fi
fi

if [[ -n ${SEL[mcp-azure]:-} ]] && ! installed mcp-azure; then
  url=${ADO_ORG_URL:-} pat=${ADO_PAT:-} ver=${ADO_API_VERSION:-} proj=${ADO_DEFAULT_PROJECT:-}
  if ((DRY)); then
    url=${url:-'<url>'} pat='<pat>'
  elif ((!YES)); then
    if [[ -z $url ]]; then read -r -p "  Azure DevOps Server collection URL (https://tfs.company/tfs/DefaultCollection): " url; fi
    if [[ -z $pat ]]; then pat=$(secret "Azure DevOps PAT"); fi
    if [[ -z $ver ]]; then read -r -p "  REST API version (2022=7.0, 2020=6.0, 2019=5.0) [7.0]: " ver; fi
    if [[ -z $proj ]]; then read -r -p "  Default project (optional): " proj; fi
  fi
  if [[ -z $url || -z $pat ]]; then
    warn "mcp-azure skipped: needs ADO_ORG_URL and ADO_PAT (or run interactively)"
  else
    cfg=(--config "ado_org_url=$url" --config "ado_pat=$pat" --config "ado_api_version=${ver:-7.0}")
    if [[ -n $proj ]]; then cfg+=(--config "ado_default_project=$proj"); fi
    install mcp-azure "${cfg[@]}"
  fi
fi

refresh
# Copies of the same plugins from claude-plugins-official or ponytail would load twice.
while read -r id; do
  [[ -n $id && ${id#*@} != "$MARKET" ]] || continue
  for b in "${BUNDLE[@]}" "${OPTINS[@]}"; do
    if [[ ${id%@*} == "$b" ]]; then warn "$id is also enabled and loads twice: claude plugin uninstall $id"; fi
  done
done < <(awk -F'"' '/"id":/ {id=$4} /"enabled": *true/ {print id}' <<<"$PLUGINS")

# --- settings.json ---------------------------------------------------------
say "==> Settings ($SETTINGS)"
snippet="{
  \"permissions\": { \"allow\": [\"$PERM\"] },
  \"extraKnownMarketplaces\": {
    \"$MARKET\": { \"source\": { \"source\": \"github\", \"repo\": \"$REPO\" }, \"autoUpdate\": true }
  }
}"
JQ=()
if has jq; then JQ=(jq)
elif has nix && nix run nixpkgs#jq -- -n 1 >/dev/null 2>&1; then JQ=(nix run nixpkgs#jq --)
fi
# shellcheck disable=SC2016  # $perm/$m/$repo are jq variables
FILTER='(.permissions.allow //= [])
  | (if any(.permissions.allow[]; . == $perm) then . else .permissions.allow += [$perm] end)
  | .extraKnownMarketplaces[$m].source //= {source: "github", repo: $repo}
  | .extraKnownMarketplaces[$m].autoUpdate = true'

if [[ -L $SETTINGS ]]; then
  warn "$SETTINGS is a symlink (managed elsewhere?); merge this in by hand:"
  say "$snippet"
elif ((${#JQ[@]} == 0)); then
  warn "no jq or nix found; merge this into $SETTINGS by hand:"
  say "$snippet"
else
  if [[ -f $SETTINGS ]]; then
    old=$("${JQ[@]}" . "$SETTINGS") || die "$SETTINGS is not valid JSON"
  else
    old=$("${JQ[@]}" . <<<'{}')
  fi
  new=$("${JQ[@]}" --arg perm "$PERM" --arg m "$MARKET" --arg repo "$REPO" "$FILTER" <<<"$old")
  if [[ $new == "$old" ]]; then
    ok "permission and auto-update already set"
  elif ((DRY)); then
    say "  would change:"
    diff <(printf '%s\n' "$old") <(printf '%s\n' "$new") | sed 's/^/    /' || true
  else
    mkdir -p "$(dirname "$SETTINGS")"
    if [[ -f $SETTINGS ]]; then cp "$SETTINGS" "$SETTINGS.bak"; fi
    printf '%s\n' "$new" >"$SETTINGS"
    ok "added $PERM and autoUpdate (backup: $SETTINGS.bak)"
  fi
fi

# --- external tools --------------------------------------------------------
if ((TOOLS)); then
  say "==> External tools"
  # binary|nix packages|command elsewhere
  checks=(
    "rust-analyzer|rust-analyzer|rustup component add rust-analyzer"
    "csharp-ls|csharp-ls dotnet-sdk|dotnet tool install --global csharp-ls"
    "typescript-language-server|typescript-language-server typescript|npm i -g typescript typescript-language-server"
    "pyright-langserver|pyright|npm i -g pyright"
    "nixd|nixd|see https://github.com/nix-community/nixd"
  )
  if wants mcp-azure; then checks+=("npx|nodejs_20|install Node.js 20+"); fi
  if wants graphify; then checks+=("graphify||uv tool install graphifyy"); fi

  pkgs=() cmds=()
  for c in "${checks[@]}"; do
    IFS='|' read -r bin nixpkgs cmd <<<"$c"
    if has "$bin"; then ok "$bin"; continue; fi
    printf '  ✗ %s\n' "$bin"
    MISSING+=("$bin")
    if [[ $OS == nixos && -n $nixpkgs ]]; then
      read -ra p <<<"$nixpkgs"
      pkgs+=("${p[@]}")
    else
      cmds+=("$cmd")
    fi
    if [[ $bin == graphify && $OS == nixos ]] && ! has uv; then pkgs+=(uv); fi
  done
  if ((${#pkgs[@]})); then
    say "  Add to home-manager and switch:"
    say "    home.packages = with pkgs; [ ${pkgs[*]} ];"
    say "  or import this repo's flake homeManagerModules.default and set programs.dead-claude-skills.enable = true;"
  fi
  if ((${#cmds[@]})); then
    say "  Then run:"
    printf '    %s\n' "${cmds[@]}"
  fi
fi

if wants graphify && ! has graphify; then
  warn "graphify's hooks fail on every tool call until the graphify CLI is on PATH"
fi

# --- summary ---------------------------------------------------------------
say "==> Done"
if ((DRY)); then
  say "  dry run: nothing was changed"
  if ((${#INSTALLED[@]})); then say "  would install: ${INSTALLED[*]}"; fi
elif ((${#INSTALLED[@]})); then
  say "  installed: ${INSTALLED[*]}"
fi
if ((${#MISSING[@]})); then say "  missing tools: ${MISSING[*]}"; fi
if ((${#WARNINGS[@]})); then
  say "  warnings:"
  printf '    %s\n' "${WARNINGS[@]}"
fi
say "  Restart Claude Code (or /reload-plugins) to load the changes."
