// The binaries the installer downloads or points plugins at: tui-review, web-mcp, agent-browser and cswap.exe.
import { createHash } from 'node:crypto';
import { BUNDLE } from './plugins.ts';
import { RELEASES, newer, semver } from './release.ts';

// installer/assets/agent-browser.json.
export interface AgentBrowserPin {
  upstream?: string;
  sha256?: Record<string, string>;
}

// cswap.exe: claude-swap built by .github/workflows/build-cswap.yml and attached to this repo's release
// v<package.json version> by release.yml. Windows only: the option is hidden elsewhere unless already installed.
export function cswapDownload(platform: string, env: NodeJS.ProcessEnv, release: string) {
  if (platform !== 'win32' || !env.LOCALAPPDATA) return null;
  const dir = `${env.LOCALAPPDATA}\\Programs\\cswap`;
  const url = `${RELEASES}/v${release}/cswap.exe`;
  return { url, sha256Url: `${url}.sha256`, dir, exe: `${dir}\\cswap.exe` };
}

// `cswap --version` prints "cswap 0.26.0"; the pin is the upstream tag "v0.26.0".
export const cswapCurrent = (versionOutput: string, version: string) =>
  versionOutput.trim() === `cswap ${version.replace(/^v/, '')}`;

// The user PATH with dir appended, or null when it's already there (Windows paths: case and trailing \ ignored).
export function pathWith(userPath: string | undefined, dir: string) {
  const norm = (p: string) => p.trim().replace(/\\+$/, '').toLowerCase();
  const parts = (userPath ?? '').split(';').filter((p) => p.trim());
  if (parts.some((p) => norm(p) === norm(dir))) return null;
  return [...parts, dir].join(';');
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
  ['cswap', 'cswap', 'uv tool install claude-swap', 'rerun this installer (cswap.exe download)'],
];

// wanted: plugin names (plus 'ccstatusline' when that toggle is on). onPath(binary) -> bool.
export function missingBinaries(platform: string, wanted: string[], onPath: (binary: string) => boolean) {
  const win = platform === 'win32';
  return BINARIES.filter(([bin, for_]) => wanted.includes(for_) && !onPath(bin)).map(([binary, , nix, windows]) => {
    const cmd = win ? windows : nix;
    return { binary, command: cmd.startsWith('nix: ') ? `add to home.packages: ${cmd.slice(5)}` : cmd };
  });
}

// The binaries releases ship, built per platform by .github/workflows/build-{tui-review,web-mcp}.yml and attached to the
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
