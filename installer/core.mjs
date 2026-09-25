// Pure decisions for the installer; install.mjs does all I/O.
export const MARKETPLACE = 'dead-claude-skills';
export const BUNDLE = 'dead-skills';
const PERMISSION = 'Read(~/.claude/plugins/**)';
const STATUS_LINE = { type: 'command', command: 'ccstatusline', padding: 0 };

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

export function mergeSettings(settings, { statusLine }) {
  const out = structuredClone(settings);
  const allow = out.permissions?.allow ?? [];
  out.permissions = { ...out.permissions, allow: allow.includes(PERMISSION) ? allow : [...allow, PERMISSION] };
  out.extraKnownMarketplaces = {
    ...out.extraKnownMarketplaces,
    [MARKETPLACE]: { source: { source: 'github', repo: 'deadmade/dead-claude-skills' }, autoUpdate: true },
  };
  if (statusLine && !isOurStatusLine(out.statusLine)) out.statusLine = STATUS_LINE;
  if (!statusLine && isOurStatusLine(out.statusLine)) delete out.statusLine;
  return out;
}

export function safeArg(s) {
  if (!/^[a-z0-9@.:=/_-]+$/i.test(s)) throw new Error(`refusing unsafe argument: ${JSON.stringify(s)}`);
  return s;
}

// [binary, needed for (plugin name), NixOS command, Windows command]
const BINARIES = [
  ['rust-analyzer', BUNDLE, 'nix: rust-analyzer', 'rustup component add rust-analyzer'],
  ['csharp-ls', BUNDLE, 'nix: csharp-ls dotnet-sdk', 'dotnet tool install --global csharp-ls'],
  ['typescript-language-server', BUNDLE, 'nix: typescript-language-server typescript', 'npm i -g typescript typescript-language-server'],
  ['pyright-langserver', BUNDLE, 'nix: pyright', 'npm i -g pyright'],
  ['nixd', BUNDLE, 'nix: nixd', `/plugin disable nix-lsp@${MARKETPLACE}   (nixd isn't available on Windows)`],
  ['jq', BUNDLE, 'nix: jq', 'winget install -e --id jqlang.jq'],
  ['uv', 'graphify', 'nix: uv', 'winget install -e --id astral-sh.uv'],
  ['graphify', 'graphify', 'uv tool install graphifyy', 'uv tool install graphifyy'],
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
