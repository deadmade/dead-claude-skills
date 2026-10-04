// Pure decisions for the installer; install.mjs does all I/O.
export const MARKETPLACE = 'dead-claude-skills';
export const BUNDLE = 'dead-skills';
// Anthropic's own plugins come straight from their marketplace: ours may not reuse their names.
export const OFFICIAL = 'claude-plugins-official';
const OFFICIAL_OPT_INS = ['skill-creator', 'rust-analyzer-lsp', 'csharp-lsp', 'typescript-lsp', 'pyright-lsp'];
const PERMISSION = 'Read(~/.claude/plugins/**)';
const STATUS_LINE = { type: 'command', command: 'ccstatusline', padding: 0 };
// Always denied, sandbox or not. The sandbox also blocks Bash reads of these, except the ** globs it can't apply on
// Linux; the ./ dotenv names cover the project root there.
export const SECRET_DENIES = [
  'Read(**/.env)', 'Read(**/.env.*)',
  ...['', '.local', '.development', '.development.local', '.production', '.production.local', '.test', '.test.local']
    .map((s) => `Read(./.env${s})`),
  'Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.azure/**)',
  'Read(~/.config/gh/**)', 'Read(~/.gnupg/**)',
];
// The sandbox keys we own; excludedCommands, network etc. stay the user's.
const SANDBOX = { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false };
const DCG = 'https://raw.githubusercontent.com/Dicklesworthstone/destructive_command_guard/main';

export const nameOf = (id) => id.split('@')[0];
const marketOf = (id) => id.split('@')[1];
// Bare dependency names resolve against our marketplace, like Claude Code does.
const idOf = (dep) => (dep.includes('@') ? dep : `${dep}@${MARKETPLACE}`);

export const bundleIds = (bundle) => [idOf(BUNDLE), ...bundle.dependencies.map(idOf)];

export const optIns = (marketplace, bundle) => [
  ...marketplace.plugins.map((p) => idOf(p.name)).filter((id) => !bundleIds(bundle).includes(id)),
  ...OFFICIAL_OPT_INS.map((n) => `${n}@${OFFICIAL}`),
];

export const needsToken = (pluginJson) =>
  Object.values(pluginJson.userConfig ?? {}).some((c) => c.sensitive === true);

// All plugin ids. installedIds: installed bundle and opt-ins only.
export function planPlugins(selected, installedIds, tokenPlugins) {
  const missing = selected.filter((id) => !installedIds.includes(id));
  return {
    install: missing.filter((id) => !tokenPlugins.includes(id)),
    handoff: missing.filter((id) => tokenPlugins.includes(id)),
    uninstall: installedIds.filter((id) => !selected.includes(id)),
  };
}

// A plugin we manage, installed from a marketplace we don't take it from (it'd load twice).
export const duplicates = (installedIds, managedIds) =>
  installedIds.filter((id) => !managedIds.includes(id) && managedIds.some((m) => nameOf(m) === nameOf(id)));

export const isOurStatusLine = (s) => typeof s?.command === 'string' && s.command.includes('ccstatusline');

export const isSandboxOn = (s) => s?.sandbox?.enabled === true;

export const hasDcgHook = (s) =>
  (s?.hooks?.PreToolUse ?? []).some((e) => e?.hooks?.some((h) => /dcg(\.exe)?"?$/i.test(h?.command ?? '')));

export function mergeSettings(settings, { statusLine, sandbox }) {
  const out = structuredClone(settings);
  const allow = out.permissions?.allow ?? [];
  const deny = out.permissions?.deny ?? [];
  out.permissions = {
    ...out.permissions,
    allow: allow.includes(PERMISSION) ? allow : [...allow, PERMISSION],
    deny: [...deny, ...SECRET_DENIES.filter((d) => !deny.includes(d))],
  };
  out.extraKnownMarketplaces = {
    ...out.extraKnownMarketplaces,
    [MARKETPLACE]: { source: { source: 'github', repo: 'deadmade/dead-claude-skills' }, autoUpdate: true },
  };
  if (statusLine && !isOurStatusLine(out.statusLine)) out.statusLine = STATUS_LINE;
  if (!statusLine && isOurStatusLine(out.statusLine)) delete out.statusLine;
  if (sandbox) out.sandbox = { ...out.sandbox, ...SANDBOX };
  else if (out.sandbox) {
    for (const k of Object.keys(SANDBOX)) delete out.sandbox[k];
    if (!Object.keys(out.sandbox).length) delete out.sandbox;
  }
  return out;
}

// Settings that switch off Anthropic's defaults: claude.ai connectors, synced skills/plugins and default-on builtin
// plugins. Values are what Claude Code 2.1.289 reads.
const STRIP = { disableClaudeAiConnectors: true, syncClaudeAiSkills: false, syncClaudeAiPlugins: false };
const STRIP_PLUGINS = { 'agents-md@builtin': false, 'telemetry@builtin': false };

// User-authored config under CLAUDE_CONFIG_DIR that a clean slate backs up and removes. Credentials, ~/.claude.json,
// projects/, plugins/, history and other app state are never touched.
export const CLEAN_TARGETS = ['CLAUDE.md', 'skills', 'agents', 'commands', 'rules', 'output-styles', 'workflows', 'hooks'];

// Everything not from our marketplace, except the official plugins we use.
export const foreignPlugins = (installedIds, managedIds) =>
  installedIds.filter((id) => marketOf(id) !== MARKETPLACE && !managedIds.includes(id));

export const foreignMarketplaces = (names) => names.filter((n) => n !== MARKETPLACE && n !== OFFICIAL);

export const isStripped = (s) => Object.entries(STRIP).every(([k, v]) => s?.[k] === v);

// One-way: unchecking it later changes nothing, since these keys are often set by hand too.
export function stripDefaults(settings) {
  const out = { ...structuredClone(settings), ...STRIP };
  out.enabledPlugins = { ...out.enabledPlugins, ...STRIP_PLUGINS };
  // Another marketplace listed here would be re-added on the next launch.
  for (const name of foreignMarketplaces(Object.keys(out.extraKnownMarketplaces ?? {}))) delete out.extraKnownMarketplaces[name];
  return out;
}

// Clean slate: only our settings survive, plus the official marketplace's entry and enabledPlugins entries from ours
// and it (claude plugin install writes them; strip already uninstalled the official plugins we don't use)
// and dcg's hook while dcg stays on (its installer only reruns on a toggle change, so dropping it would disable dcg).
export function resetSettings(settings, { dcg, ...toggles }) {
  const out = stripDefaults(mergeSettings({}, toggles));
  for (const [id, v] of Object.entries(settings.enabledPlugins ?? {})) {
    if ([MARKETPLACE, OFFICIAL].includes(marketOf(id))) out.enabledPlugins[id] = v;
  }
  const official = settings.extraKnownMarketplaces?.[OFFICIAL];
  if (official) out.extraKnownMarketplaces[OFFICIAL] = official;
  if (dcg && hasDcgHook(settings)) {
    out.hooks = { PreToolUse: settings.hooks.PreToolUse.filter((e) => hasDcgHook({ hooks: { PreToolUse: [e] } })) };
  }
  return out;
}

// dcg's own installer/uninstaller: they install the binary and write or remove its Claude Code hook.
export function dcgCommand(platform, action) {
  if (platform === 'win32') {
    const script = action === 'install' ? 'install.ps1' : 'uninstall.ps1';
    const flags = action === 'install' ? ' -EasyMode -Verify' : '';
    return ['powershell', ['-NoProfile', '-Command', `& ([scriptblock]::Create((irm '${DCG}/${script}')))${flags}`]];
  }
  // No --easy-mode: it edits shell rc files, which home-manager owns on NixOS.
  const [script, flags] = action === 'install' ? ['install.sh', '--verify'] : ['uninstall.sh', '--yes'];
  return ['bash', ['-c', `curl -fsSL '${DCG}/${script}' | bash -s -- ${flags}`]];
}

export function safeArg(s) {
  if (!/^[a-z0-9@.:=/_-]+$/i.test(s)) throw new Error(`refusing unsafe argument: ${JSON.stringify(s)}`);
  return s;
}

// [binary, needed for (plugin name), NixOS command, Windows command]
const BINARIES = [
  ['rust-analyzer', 'rust-analyzer-lsp', 'nix: rust-analyzer', 'rustup component add rust-analyzer'],
  ['csharp-ls', 'csharp-lsp', 'nix: csharp-ls dotnet-sdk', 'dotnet tool install --global csharp-ls'],
  ['typescript-language-server', 'typescript-lsp', 'nix: typescript-language-server typescript', 'npm i -g typescript typescript-language-server'],
  ['pyright-langserver', 'pyright-lsp', 'nix: pyright', 'npm i -g pyright'],
  ['nixd', 'nix-lsp', 'nix: nixd', 'not available on Windows, deselect nix-lsp'],
  ['jq', BUNDLE, 'nix: jq', 'winget install -e --id jqlang.jq'],
  ['python3', BUNDLE, 'nix: python3', 'winget install -e --id Python.Python.3.13'],
  ['uv', 'graphify', 'nix: uv', 'winget install -e --id astral-sh.uv'],
  ['graphify', 'graphify', 'uv tool install graphifyy', 'uv tool install graphifyy'],
  ['bwrap', 'sandbox', 'nix: bubblewrap', 'WSL2 only'],
  ['socat', 'sandbox', 'nix: socat', 'WSL2 only'],
  ['ccstatusline', 'ccstatusline', 'nix: ccstatusline', 'npm i -g ccstatusline'],
];

// wanted: plugin names (plus 'ccstatusline' when that toggle is on). onPath(binary) -> bool.
export function missingBinaries(platform, wanted, onPath) {
  const win = platform === 'win32';
  return BINARIES.filter(([bin, for_]) => wanted.includes(for_) && !onPath(bin))
    .map(([binary, , nix, windows]) => {
      const cmd = win ? windows : nix;
      return { binary, command: cmd.startsWith('nix: ') ? `add to home.packages: ${cmd.slice(5)}` : cmd };
    });
}
