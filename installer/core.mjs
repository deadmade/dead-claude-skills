// Pure decisions for the installer; install.mjs does all I/O.
export const MARKETPLACE = 'dead-claude-skills';
export const BUNDLE = 'dead-skills';
const PERMISSION = 'Read(~/.claude/plugins/**)';
const STATUS_LINE = { type: 'command', command: 'ccstatusline', padding: 0 };
// Always denied, sandbox or not. With the sandbox on, Bash reads of these paths are blocked too.
export const SECRET_DENIES = [
  'Read(**/.env)', 'Read(**/.env.*)', 'Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.azure/**)',
  'Read(~/.config/gh/**)', 'Read(~/.gnupg/**)',
];
// The sandbox keys we own; excludedCommands, network etc. stay the user's.
const SANDBOX = { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false };
const DCG = 'https://raw.githubusercontent.com/Dicklesworthstone/destructive_command_guard/main';

const nameOf = (id) => id.split('@')[0];
const marketOf = (id) => id.split('@')[1];

export const optIns = (marketplace, bundle) =>
  marketplace.plugins.map((p) => p.name).filter((n) => n !== BUNDLE && !bundle.dependencies.includes(n));

export const needsToken = (pluginJson) =>
  Object.values(pluginJson.userConfig ?? {}).some((c) => c.sensitive === true);

// installedIds: installed opt-ins from our marketplace only.
export function planPlugins(selected, installedIds, tokenPlugins) {
  const installed = installedIds.map(nameOf);
  const missing = selected.filter((n) => !installed.includes(n));
  return {
    install: missing.filter((n) => !tokenPlugins.includes(n)),
    handoff: missing.filter((n) => tokenPlugins.includes(n)),
    uninstall: installedIds.filter((id) => !selected.includes(nameOf(id))),
  };
}

export const duplicates = (installedIds, ourNames) =>
  installedIds.filter((id) => marketOf(id) !== MARKETPLACE && ourNames.includes(nameOf(id)));

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
