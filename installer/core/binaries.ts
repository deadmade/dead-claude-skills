// The binaries the installer downloads or points plugins at: tui-review, web-mcp and agent-browser.
import { createHash } from 'node:crypto';
import { BUNDLE } from './plugins.ts';
import { RELEASES, newer, semver } from './release.ts';

// installer/assets/agent-browser.json.
export interface AgentBrowserPin {
  upstream?: string;
  sha256?: Record<string, string>;
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
  ['ccstatusline', 'ccstatusline', 'nix: ccstatusline', 'npm i -g ccstatusline'],
];

// wanted: plugin names (plus 'ccstatusline' when that toggle is on). onPath(binary) -> bool.
export function missingBinaries(platform: string, wanted: string[], onPath: (binary: string) => boolean) {
  const win = platform === 'win32';
  return BINARIES.filter(([bin, for_]) => wanted.includes(for_) && !onPath(bin)).map(([binary, , nix, windows]) => {
    const cmd = win ? windows : nix;
    return { binary, command: cmd.startsWith('nix: ') ? `add to home.packages: ${cmd.slice(5)}` : cmd };
  });
}

// The binaries releases ship, built per platform by .github/workflows/crates-build.yml and attached to the
// vX.Y.Z release by release.yml. plugin: which plugin needs it; key: its userConfig key for the binary's path.
export const BIN_PLUGINS: Record<string, { name: string; key: string }> = {
  'tui-review': { name: 'tui-review', key: 'binPath' },
  'web-mcp': { name: 'web-mcp', key: 'binPath' },
};
// Windows and Linux x64 only: no macOS or ARM builds.
const BIN_TARGETS: Record<string, string> = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-musl',
};

// The release archive of binary `name` ('tui-review' or 'web-mcp') at `version` for this machine, or undefined where none is built.
export function binAsset(name: string, platform: string, arch: string, version: string) {
  const target = BIN_TARGETS[`${platform}-${arch}`];
  if (!target) return undefined;
  const file = `${name}-${target}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const url = `${RELEASES}/v${version}/${file}`;
  return { file, url, sha256: `${url}.sha256`, exe: platform === 'win32' ? `${name}.exe` : name };
}

// The checksum a `sha256sum` line starts with, lowercased; undefined when the text is not one.
export const sha256Of = (text: string) => /^[0-9a-f]{64}(?=\s|$)/i.exec(text.trim())?.[0].toLowerCase();

// Whether bytes hash to want, a lowercase hex sha256 (sha256Of's or a pinned one); never true without want.
export const sha256Matches = (bytes: Buffer, want: string | undefined) =>
  !!want && createHash('sha256').update(bytes).digest('hex') === want;

// What to do about a binary: `skip` (one on PATH is the user's own), `configure` (ours is current, point the plugin at
// it), `download` (none, or an older one), or `unsupported` (no build for this machine).
// installed: the version our copy reports, or undefined when there is none.
export function binAction({
  onPath,
  installed,
  version,
  supported,
}: {
  onPath: boolean;
  installed: string | undefined;
  version: string;
  supported: boolean;
}) {
  if (onPath) return 'skip';
  if (installed === version) return 'configure';
  return supported ? 'download' : 'unsupported';
}

// installed: version from `agent-browser --version` or undefined; pinned: installer/assets/agent-browser.json. A newer one stays.
export const agentBrowserAction = ({ installed, pinned }: { installed: string | undefined; pinned: string }) =>
  !installed ? 'install' : installed === pinned || newer(installed, pinned) ? 'skip' : 'upgrade';

// Which agent-browser web-mcp runs: a current one on PATH as is, else ours in ~/.claude/bin, downloaded when missing
// or older than the pin.
export const agentBrowserPlan = ({
  theirs,
  ours,
  pinned,
}: {
  theirs: string | undefined;
  ours: string | undefined;
  pinned: string;
}) =>
  theirs && agentBrowserAction({ installed: theirs, pinned }) === 'skip'
    ? { use: 'path' }
    : { use: 'ours', download: agentBrowserAction({ installed: ours, pinned }) };

// Why web-mcp's one browser window can't open on this machine, or undefined. search, browser and the fetch fallback all need it.
export function windowProblem(o: {
  browserRuns: boolean;
  platform: NodeJS.Platform;
  display: boolean;
  xvfb: boolean;
}): string | undefined {
  if (!o.browserRuns)
    return "web-mcp's browser window can't open: no browser it can use. search, browser and the fetch fallback won't work until you run agent-browser install, or install Helium or Chromium.";
  if (o.platform === 'linux' && !o.display && !o.xvfb)
    return "web-mcp's browser window can't open: this Linux has no display and no Xvfb. search, browser and the fetch fallback won't work until you install Xvfb or run Claude Code in a desktop session.";
  return undefined;
}

// agent-browser's own release binaries (statically linked musl on Linux, so NixOS runs it), keyed like BIN_TARGETS.
export const AGENT_BROWSER_FILES: Record<string, string> = {
  'win32-x64': 'agent-browser-win32-x64.exe',
  'linux-x64': 'agent-browser-linux-musl-x64',
};

// The upstream binary for pin (installer/assets/agent-browser.json) on this machine, checked against the pin's sha256, or
// undefined where there is no build or no pinned hash.
export function agentBrowserAsset(platform: string, arch: string, pin: AgentBrowserPin) {
  const key = `${platform}-${arch}`;
  const [file, digest] = [AGENT_BROWSER_FILES[key], pin.sha256?.[key]];
  if (!file || !semver(pin.upstream) || !/^[0-9a-f]{64}$/.test(digest ?? '')) return undefined;
  const url = `https://github.com/vercel-labs/agent-browser/releases/download/v${pin.upstream}/${file}`;
  return { file, url, digest, raw: true, exe: platform === 'win32' ? 'agent-browser.exe' : 'agent-browser' };
}

// `agent-browser --version` may print a name prefix ("agent-browser 0.39.1"); undefined when no version is in it.
export const agentBrowserVersion = (out: string | undefined) => /(\d+\.\d+\.\d+)/.exec(out ?? '')?.[1];

// The newest `chrome-<a>.<b>.<c>.<d>` among a browsers folder's entries, compared numerically (upstream sorts the names
// as strings, where chrome-99 beats chrome-156).
export const newestChromeForTesting = (entries: string[]) =>
  entries
    .map((e) => ({ e, v: /^chrome-(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(e)?.slice(1).map(Number) }))
    .filter((x): x is { e: string; v: number[] } => !!x.v)
    .sort((a, b) => a.v.reduce((d, n, i) => d || n - b.v[i]!, 0))
    .at(-1)?.e;
