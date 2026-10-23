// The installer's pages and toggles, and what each option runs or why it can't run here.
import { BIN_PLUGINS, binAsset } from './binaries.ts';
import { INCLUDED, OFFICIAL, nameOf } from './plugins.ts';
import { MARKETPLACE } from './release.ts';
import { CLEAN_TARGETS } from './settings.ts';

export interface Page {
  id: string;
  title: string;
  blurb: string;
  keys: string[];
  bulk?: boolean;
}

const DCG = 'https://raw.githubusercontent.com/Dicklesworthstone/destructive_command_guard/main';

// dcg's own installer/uninstaller: they install the binary and write or remove its Claude Code hook.
export function dcgCommand(platform: string, action: 'install' | 'uninstall'): [string, string[]] {
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

// The installer's pages, in order. keys: plugin names and installer toggles; an opt-in not listed here lands in Other,
// so a new marketplace plugin is never left out.
export const TOGGLES = ['ccstatusline', 'sandbox', 'dcg', 'strip-defaults', 'clean', 'web-builtins-off'];
export const CATEGORIES: Page[] = [
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
    keys: ['graphify', 'tui-review', 'web-mcp', 'web-builtins-off', 'md-pane'],
  },
  {
    id: 'system',
    title: 'System',
    blurb: 'Status line, sandbox and command guard.',
    keys: ['ccstatusline', 'sandbox', 'dcg'],
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
export function categorize(keys: string[]) {
  const known = CATEGORIES.flatMap((c) => c.keys);
  const pages = CATEGORIES.map((c) => ({ ...c, keys: c.keys.flatMap((n) => keys.filter((k) => nameOf(k) === n)) }));
  const rest = keys.filter((k) => !known.includes(nameOf(k)) && !INCLUDED.includes(nameOf(k)));
  if (rest.length) pages.push({ id: 'other', title: 'Other', blurb: 'Not sorted into a category yet.', keys: rest });
  return pages.filter((c) => c.keys.length);
}

// Short descriptions for what marketplace.json doesn't describe: the official opt-ins and the toggles.
export const HINTS: Record<string, string> = {
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
export function unavailable(key: string, platform: string, arch: string, version: string): string | undefined {
  const name = nameOf(key);
  if (platform === 'win32' && name === 'sandbox') return 'needs WSL2';
  if (platform === 'win32' && name === 'nix-lsp') return 'nixd is not available on Windows';
  if (name === 'web-builtins-off') return unavailable(`web-mcp@${MARKETPLACE}`, platform, arch, version);
  const bin = BIN_PLUGINS[name];
  if (bin && !binAsset(bin.name, platform, arch, version)) return `no ${bin.name} build for ${platform}-${arch}`;
  return undefined;
}
