// Pure decisions for the installer; install.mjs does all I/O.
export const MARKETPLACE = 'dead-claude-skills';
export const BUNDLE = 'dead-skills';
// Anthropic's own plugins come straight from their marketplace: ours may not reuse their names.
export const OFFICIAL = 'claude-plugins-official';
const OFFICIAL_OPT_INS = [
  'skill-creator',
  'hookify',
  'rust-analyzer-lsp',
  'csharp-lsp',
  'typescript-lsp',
  'pyright-lsp',
];
const PERMISSION = 'Read(~/.claude/plugins/**)';
const STATUS_LINE = { type: 'command', command: 'ccstatusline', padding: 0 };
// Always denied, sandbox or not. The sandbox also blocks Bash reads of these, except the ** globs it can't apply on
// Linux; the ./ dotenv names cover the project root there.
export const SECRET_DENIES = [
  'Read(**/.env)',
  'Read(**/.env.*)',
  ...[
    '',
    '.local',
    '.development',
    '.development.local',
    '.production',
    '.production.local',
    '.test',
    '.test.local',
  ].map((s) => `Read(./.env${s})`),
  'Read(~/.ssh/**)',
  'Read(~/.aws/**)',
  'Read(~/.azure/**)',
  'Read(~/.config/gh/**)',
  'Read(~/.gnupg/**)',
];
// The sandbox keys we own; excludedCommands, network etc. stay the user's.
const SANDBOX = { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false };
const DCG = 'https://raw.githubusercontent.com/Dicklesworthstone/destructive_command_guard/main';

export const nameOf = (id) => id.split('@')[0];

// Repo-relative manifest path of a marketplace plugin with a local (string) source; null for url sources and unknown names.
export function manifestPath(manifest, id) {
  const source = manifest.plugins.find((p) => p.name === nameOf(id))?.source;
  return typeof source === 'string' ? `${source.replace(/^\.\//, '')}/.claude-plugin/plugin.json` : null;
}

// Our marketplace at the release tag of the installer that runs, so the plugins always match it: updating means
// running a newer installer. As `claude plugin marketplace add` takes it, and as its settings entry.
const REPO = 'deadmade/dead-claude-skills';
export const marketplaceArg = (version) => `${REPO}@v${version}`;
const marketplaceSource = (version) => ({ source: 'github', repo: REPO, ref: `v${version}` });

// Claude Code refuses to add a marketplace whose source differs from its extraKnownMarketplaces entry, so the entry
// is pinned before the add; the add then moves the checkout to the tag and keeps its plugins. Unchanged otherwise.
export function pinMarketplace(settings, version) {
  const entry = settings?.extraKnownMarketplaces?.[MARKETPLACE];
  if (!entry || JSON.stringify(entry.source) === JSON.stringify(marketplaceSource(version))) return settings;
  const out = structuredClone(settings);
  out.extraKnownMarketplaces[MARKETPLACE].source = marketplaceSource(version);
  return out;
}
const marketOf = (id) => id.split('@')[1];
// Bare dependency names resolve against our marketplace, like Claude Code does.
export const idOf = (dep) => (dep.includes('@') ? dep : `${dep}@${MARKETPLACE}`);

export const bundleIds = (bundle) => [idOf(BUNDLE), ...bundle.dependencies.map(idOf)];

export const optIns = (marketplace, bundle) => [
  ...marketplace.plugins.map((p) => idOf(p.name)).filter((id) => !bundleIds(bundle).includes(id)),
  ...OFFICIAL_OPT_INS.map((n) => `${n}@${OFFICIAL}`),
];

export const needsToken = (pluginJson) => Object.values(pluginJson.userConfig ?? {}).some((c) => c.sensitive === true);

// All plugin ids. installedIds: installed bundle and opt-ins only.
export function planPlugins(selected, installedIds, tokenPlugins) {
  const missing = selected.filter((id) => !installedIds.includes(id));
  return {
    install: missing.filter((id) => !tokenPlugins.includes(id)),
    handoff: missing.filter((id) => tokenPlugins.includes(id)),
    uninstall: installedIds.filter((id) => !selected.includes(id)),
  };
}

// Plugins only the flows conductors use: they come with flows (its dependencies) and get no row of their own.
export const INCLUDED = ['mattpocock-picks', 'pstack-picks', 'tob-picks', 'self-review', 'paper-lookup'];

// selected plus the opt-ins among their dependencies, transitively. depsOf(id): a plugin's dependency ids, if any.
export function withDependencies(selected, depsOf, opts) {
  const out = [...selected];
  for (let i = 0; i < out.length; i++)
    for (const d of depsOf(out[i]) ?? []) if (opts.includes(d) && !out.includes(d)) out.push(d);
  return out;
}

// A plugin we manage, installed from a marketplace we don't take it from (it'd load twice).
export const duplicates = (installedIds, managedIds) =>
  installedIds.filter((id) => !managedIds.includes(id) && managedIds.some((m) => nameOf(m) === nameOf(id)));

export const isOurStatusLine = (s) => typeof s?.command === 'string' && s.command.includes('ccstatusline');

export const isSandboxOn = (s) => s?.sandbox?.enabled === true;

export const hasDcgHook = (s) =>
  (s?.hooks?.PreToolUse ?? []).some((e) => e?.hooks?.some((h) => /dcg(\.exe)?"?$/i.test(h?.command ?? '')));

const KEEP_SESSIONS_DAYS = 36500;

// True when text is JSON equal to any shipped config text (whitespace-insensitive).
export const isShipped = (text, shippedTexts) => {
  try {
    const cur = JSON.stringify(JSON.parse(text));
    return shippedTexts.some((s) => JSON.stringify(JSON.parse(s)) === cur);
  } catch {
    return false;
  }
};

const WEB_BUILTINS = ['WebFetch', 'WebSearch'];
export const isWebBuiltinsOff = (s) => WEB_BUILTINS.every((d) => s?.permissions?.deny?.includes(d));

// The SearXNG container web-mcp searches through, bound to loopback only; configDir holds settings.yml.
// shortcut: unpinned latest tag, pin when an upgrade breaks the JSON API.
export const searxngRun = (configDir) => [
  'run',
  '-d',
  '--name',
  'searxng',
  '--restart',
  'unless-stopped',
  '-p',
  '127.0.0.1:8888:8080',
  '-v',
  `${configDir}:/etc/searxng/`,
  'docker.io/searxng/searxng:latest',
];

export const searxngSettings = (template, secret) => template.replace(/^(\s*secret_key:).*$/m, `$1 "${secret}"`);

// The built-in web tools' new state: true deny them, false allow them again, undefined leave them.
// toggle: the choice; was: it was on before; healthy: SearXNG answered JSON; installed: web-mcp was installed before
// this run (only then can the denies be ours; someone who never had web-mcp keeps theirs).
// Only an explicit on to off allows them again: a down SearXNG must not undo denies that are already there.
export const webBuiltinsDecision = ({ toggle, was, healthy, installed }) =>
  toggle ? healthy || undefined : was && installed ? false : undefined;

export function mergeSettings(settings, { statusLine, sandbox, version, notify, webBuiltinsOff }) {
  const out = structuredClone(settings);
  // Night City ships with the bundle. Claude Code colours code in a fixed Monokai a theme can't change; off, diffs take
  // Night City's own diff colours.
  out.syntaxHighlightingDisabled = true;
  // Inside tmux Claude Code draws in 256 colours unless told otherwise, which turns the theme's indigos grey. Outside
  // tmux (and on Windows, which has none) the variable does nothing.
  out.env = { ...out.env, CLAUDE_CODE_TMUX_TRUECOLOR: '1' };
  // The notify plugin raises its own popups; Claude Code's built-in one would double them.
  // shortcut: deselecting also clears a `notifications_disabled` the user set themselves, and retiring notify from
  // the marketplace leaves the setting behind; remember who set it if anyone minds.
  if (notify) out.preferredNotifChannel = 'notifications_disabled';
  if (notify === false && out.preferredNotifChannel === 'notifications_disabled') delete out.preferredNotifChannel;
  const allow = out.permissions?.allow ?? [];
  const deny = out.permissions?.deny ?? [];
  let denied = [...deny, ...SECRET_DENIES.filter((d) => !deny.includes(d))];
  // web-mcp replaces the built-in web tools once SearXNG answers.
  // shortcut: false also removes WebFetch/WebSearch entries the user added by hand; remember who set them if anyone minds.
  if (webBuiltinsOff) denied = [...denied, ...WEB_BUILTINS.filter((d) => !denied.includes(d))];
  if (webBuiltinsOff === false) denied = denied.filter((d) => !WEB_BUILTINS.includes(d));
  out.permissions = {
    ...out.permissions,
    allow: allow.includes(PERMISSION) ? allow : [...allow, PERMISSION],
    deny: denied,
  };
  out.extraKnownMarketplaces = {
    ...out.extraKnownMarketplaces,
    [MARKETPLACE]: { source: marketplaceSource(version), autoUpdate: true },
  };
  // Claude Code deletes session transcripts after 30 days by default; a value set by hand wins.
  out.cleanupPeriodDays ??= KEEP_SESSIONS_DAYS;
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
export const CLEAN_TARGETS = [
  'CLAUDE.md',
  'skills',
  'agents',
  'commands',
  'rules',
  'output-styles',
  'workflows',
  'hooks',
];

// Everything not from our marketplace, except the official plugins we use.
export const foreignPlugins = (installedIds, managedIds) =>
  installedIds.filter((id) => marketOf(id) !== MARKETPLACE && !managedIds.includes(id));

// Ours but gone from the marketplace (dev-feature): nothing can update them, so every run removes them.
export const retiredPlugins = (installedIds, managedIds) =>
  installedIds.filter((id) => marketOf(id) === MARKETPLACE && !managedIds.includes(id));

export const foreignMarketplaces = (names) => names.filter((n) => n !== MARKETPLACE && n !== OFFICIAL);

export const isStripped = (s) => Object.entries(STRIP).every(([k, v]) => s?.[k] === v);

// One-way: unchecking it later changes nothing, since these keys are often set by hand too.
export function stripDefaults(settings) {
  const out = { ...structuredClone(settings), ...STRIP };
  out.enabledPlugins = { ...out.enabledPlugins, ...STRIP_PLUGINS };
  // Another marketplace listed here would be re-added on the next launch.
  for (const name of foreignMarketplaces(Object.keys(out.extraKnownMarketplaces ?? {})))
    delete out.extraKnownMarketplaces[name];
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

// settings.json as written back over raw: two-space JSON with raw's line endings.
export const settingsText = (raw, obj) => {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return JSON.stringify(obj, null, 2).replaceAll('\n', eol) + eol;
};

// What writing build(settings) over raw changes: undefined when raw isn't JSON, null when nothing changes.
export function settingsChange(raw, build) {
  let before;
  try {
    before = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const after = build(before);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
  return changed.length ? { before, after, changed, text: settingsText(raw, after) } : null;
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
  // pipefail: a failed download would otherwise feed bash nothing, which exits 0.
  return ['bash', ['-c', `set -o pipefail; curl -fsSL '${DCG}/${script}' | bash -s -- ${flags}`]];
}

// cswap.exe: claude-swap built by .github/workflows/build-cswap.yml and attached to this repo's release
// v<package.json version> by release.yml. Windows only: the option is hidden elsewhere unless already installed.
const RELEASES = `https://github.com/${REPO}/releases/download`;

export function cswapDownload(platform, env, release) {
  if (platform !== 'win32' || !env.LOCALAPPDATA) return null;
  const dir = `${env.LOCALAPPDATA}\\Programs\\cswap`;
  const url = `${RELEASES}/v${release}/cswap.exe`;
  return { url, sha256Url: `${url}.sha256`, dir, exe: `${dir}\\cswap.exe` };
}

// `cswap --version` prints "cswap 0.26.0"; the pin is the upstream tag "v0.26.0".
export const cswapCurrent = (versionOutput, version) => versionOutput.trim() === `cswap ${version.replace(/^v/, '')}`;

// The user PATH with dir appended, or null when it's already there (Windows paths: case and trailing \ ignored).
export function pathWith(userPath, dir) {
  const norm = (p) => p.trim().replace(/\\+$/, '').toLowerCase();
  const parts = (userPath ?? '').split(';').filter((p) => p.trim());
  if (parts.some((p) => norm(p) === norm(dir))) return null;
  return [...parts, dir].join(';');
}

export function safeArg(s) {
  if (!/^[a-z0-9@.:=/_-]+$/i.test(s)) throw new Error(`refusing unsafe argument: ${JSON.stringify(s)}`);
  return s;
}

// [binary, needed for (plugin name), NixOS command, Windows command]
const BINARIES = [
  ['rust-analyzer', 'rust-analyzer-lsp', 'nix: rust-analyzer', 'rustup component add rust-analyzer'],
  ['csharp-ls', 'csharp-lsp', 'nix: csharp-ls dotnet-sdk', 'dotnet tool install --global csharp-ls'],
  [
    'typescript-language-server',
    'typescript-lsp',
    'nix: typescript-language-server typescript',
    'npm i -g typescript typescript-language-server',
  ],
  ['pyright-langserver', 'pyright-lsp', 'nix: pyright', 'npm i -g pyright'],
  ['nixd', 'nix-lsp', 'nix: nixd', 'not available on Windows, deselect nix-lsp'],
  ['jq', BUNDLE, 'nix: jq', 'winget install -e --id jqlang.jq'],
  ['python3', BUNDLE, 'nix: python3', 'winget install -e --id Python.Python.3.13'],
  ['uv', 'graphify', 'nix: uv', 'winget install -e --id astral-sh.uv'],
  ['graphify', 'graphify', 'uv tool install graphifyy', 'uv tool install graphifyy'],
  ['bwrap', 'sandbox', 'nix: bubblewrap', 'WSL2 only'],
  ['socat', 'sandbox', 'nix: socat', 'WSL2 only'],
  ['ccstatusline', 'ccstatusline', 'nix: ccstatusline', 'npm i -g ccstatusline'],
  ['docker', 'web-mcp', 'nix: docker', 'winget install -e --id Docker.DockerDesktop'],
  ['npm', 'web-mcp', 'nix: nodejs', 'winget install -e --id OpenJS.NodeJS.LTS'],
  [
    'agent-browser',
    'web-mcp',
    'npm i -g agent-browser && agent-browser install',
    'npm i -g agent-browser && agent-browser install',
  ],
  ['cswap', 'cswap', 'uv tool install claude-swap', 'rerun this installer (cswap.exe download)'],
];

// wanted: plugin names (plus 'ccstatusline' when that toggle is on). onPath(binary) -> bool.
export function missingBinaries(platform, wanted, onPath) {
  const win = platform === 'win32';
  return BINARIES.filter(([bin, for_]) => wanted.includes(for_) && !onPath(bin)).map(([binary, , nix, windows]) => {
    const cmd = win ? windows : nix;
    return { binary, command: cmd.startsWith('nix: ') ? `add to home.packages: ${cmd.slice(5)}` : cmd };
  });
}

// The binaries releases ship, built per platform by .github/workflows/build-{tui-review,web-mcp}.yml and attached to the
// vX.Y.Z release by release.yml. plugin: which plugin needs it; key: its userConfig key for the binary's path.
export const BIN_PLUGINS = {
  'tui-review': { name: 'tui-review', key: 'binPath' },
  'web-mcp': { name: 'web-mcp', key: 'binPath' },
};
const BIN_TARGETS = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
};
// Binaries built for fewer platforms than BIN_TARGETS.
const BIN_ONLY = { 'web-mcp': ['win32-x64', 'linux-x64'] };

// The release archive of binary `name` ('tui-review' or 'web-mcp') at `version` for this machine, or undefined where none is built.
export function binAsset(name, platform, arch, version) {
  const target = BIN_TARGETS[`${platform}-${arch}`];
  if (!target || BIN_ONLY[name]?.includes(`${platform}-${arch}`) === false) return undefined;
  const file = `${name}-${target}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const url = `${RELEASES}/v${version}/${file}`;
  return { file, url, sha256: `${url}.sha256`, exe: platform === 'win32' ? `${name}.exe` : name };
}

// The checksum a `sha256sum` line starts with, lowercased; undefined when the text is not one.
export const sha256Of = (text) => /^[0-9a-f]{64}(?=\s|$)/i.exec(text.trim())?.[0].toLowerCase();

// What to do about a binary: `skip` (one on PATH is the user's own), `configure` (ours is current, point the plugin at
// it), `download` (none, or an older one), or `unsupported` (no build for this machine).
// installed: the version our copy reports, or undefined when there is none.
export function binAction({ onPath, installed, version, supported }) {
  if (onPath) return 'skip';
  if (installed === version) return 'configure';
  return supported ? 'download' : 'unsupported';
}

// The installer's pages, in order. keys: plugin names and installer toggles; an opt-in not listed here lands in Other,
// so a new marketplace plugin is never left out.
export const TOGGLES = ['ccstatusline', 'sandbox', 'dcg', 'strip-defaults', 'clean', 'web-builtins-off'];
export const CATEGORIES = [
  {
    id: 'workflow',
    title: 'Conductors & skills',
    blurb: 'flows runs the other skills in order and brings the ones it uses; plus standalone skills.',
    keys: ['flows', 'hallmark', 'skill-creator', 'hookify'],
  },
  {
    id: 'lsp',
    title: 'Languages',
    blurb: 'Per-language code intelligence (servers must be on PATH) and best-practice skills.',
    keys: [
      'rust-analyzer-lsp',
      'rust-skills',
      'csharp-lsp',
      'csharp-skills',
      'typescript-lsp',
      'pyright-lsp',
      'nix-lsp',
    ],
  },
  {
    id: 'database',
    title: 'Databases',
    blurb: 'Best-practice skills for the databases you work with.',
    keys: ['postgres'],
  },
  {
    id: 'mcp',
    title: 'Integrations',
    blurb: 'MCP servers for the services you work with.',
    keys: ['mcp-github', 'mcp-azure', 'atlassian'],
  },
  {
    id: 'tools',
    title: 'Tools',
    blurb: 'Plugins that bring their own binary or pane.',
    keys: ['graphify', 'cswap', 'tui-review', 'web-mcp', 'web-builtins-off'],
  },
  {
    id: 'system',
    title: 'System',
    blurb: 'Status line, sandbox, command guard and notifications.',
    keys: ['ccstatusline', 'sandbox', 'dcg', 'notify'],
  },
  // bulk: false, so no single key ticks every option here.
  {
    id: 'danger',
    title: 'Danger zone',
    blurb: 'Take over the whole Claude Code config. Leave empty unless you mean it.',
    keys: ['strip-defaults', 'clean'],
    bulk: false,
  },
];

// keys: opt-in plugin ids and toggle names. Returns the non-empty categories with their keys, in page order.
export function categorize(keys) {
  const known = CATEGORIES.flatMap((c) => c.keys);
  const pages = CATEGORIES.map((c) => ({ ...c, keys: c.keys.flatMap((n) => keys.filter((k) => nameOf(k) === n)) }));
  const rest = keys.filter((k) => !known.includes(nameOf(k)) && !INCLUDED.includes(nameOf(k)));
  if (rest.length) pages.push({ id: 'other', title: 'Other', blurb: 'Not sorted into a category yet.', keys: rest });
  return pages.filter((c) => c.keys.length);
}

// Short descriptions for what marketplace.json doesn't describe: the official opt-ins and the toggles.
export const HINTS = {
  'skill-creator': "Anthropic's skill for writing and testing skills",
  hookify: "Anthropic's rules-as-hooks from .claude/hookify.*.local.md",
  'rust-analyzer-lsp': 'Rust (rust-analyzer)',
  'csharp-lsp': 'C# (csharp-ls)',
  'typescript-lsp': 'TypeScript / JavaScript',
  'pyright-lsp': 'Python (pyright)',
  ccstatusline: 'status line + its config',
  sandbox: 'Bash sandbox, no unsandboxed fallback',
  dcg: 'destructive command guard, runs its own installer',
  'strip-defaults': `remove other marketplaces + plugins (keeps the ${OFFICIAL} ones used here), claude.ai connectors, synced skills/plugins, builtins`,
  'web-builtins-off': 'Turn off the built-in WebSearch and WebFetch (web-mcp replaces them; only with web-mcp)',
  clean: `clean slate: back up, then reset settings.json and delete ${CLEAN_TARGETS.join(', ')}`,
};

// Why an option can't work on this machine, or undefined when it can. version: the release whose binaries to look for.
export function unavailable(key, platform, arch, version) {
  const name = nameOf(key);
  if (platform === 'win32' && name === 'sandbox') return 'needs WSL2';
  if (platform === 'win32' && name === 'nix-lsp') return 'nixd is not available on Windows';
  if (platform !== 'win32' && name === 'cswap') return 'releases ship cswap.exe for Windows only';
  if (name === 'web-builtins-off') return unavailable(`web-mcp@${MARKETPLACE}`, platform, arch, version);
  const bin = BIN_PLUGINS[name];
  if (bin && !binAsset(bin.name, platform, arch, version)) return `no ${bin.name} build for ${platform}-${arch}`;
  return undefined;
}

const semver = (v) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);
const newer = (a, b) => {
  const [x, y] = [semver(a), semver(b)];
  if (!x || !y) return false;
  const i = x.findIndex((n, k) => n !== y[k]);
  return i >= 0 && x[i] > y[i];
};

// installed: version from `agent-browser --version` or undefined; pinned: installer/agent-browser.json. A newer one stays.
export const agentBrowserAction = ({ installed, pinned }) =>
  !installed ? 'install' : installed === pinned || newer(installed, pinned) ? 'skip' : 'upgrade';

// `agent-browser --version` may print a name prefix ("agent-browser 0.39.1"); undefined when no version is in it.
export const agentBrowserVersion = (out) => /(\d+\.\d+\.\d+)/.exec(out ?? '')?.[1];

// { name: version } this release ships: a local plugin's plugin.json version (via localVersion(source)), or a url
// plugin's pinned vX.Y.Z ref. Plugins without either (unpinned url sources) are left out.
export function shippedVersions(plugins, localVersion) {
  return Object.fromEntries(
    plugins.flatMap(({ name, source }) => {
      const v = typeof source === 'string' ? localVersion(source) : /^v(\d+\.\d+\.\d+)$/.exec(source?.ref ?? '')?.[1];
      return v ? [[name, v]] : [];
    }),
  );
}

// Our installed plugins whose version differs from the one this release ships, once per id. rows: `claude plugin
// list --json`; shipped: shippedVersions(). A newer install isn't downgraded.
export function outdated(rows, shipped) {
  const seen = new Set();
  return rows.flatMap(({ id, version }) => {
    const to = shipped[nameOf(id)];
    if (marketOf(id) !== MARKETPLACE || !to || seen.has(id)) return [];
    seen.add(id);
    return version === to || newer(version, to) ? [] : [{ id, from: version, to }];
  });
}
