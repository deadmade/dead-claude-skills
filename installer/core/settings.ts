// settings.json: what the installer reads from it and the merges it writes.
import { MARKETPLACE, marketplaceSource } from './release.ts';
import { OFFICIAL, foreignMarketplaces, marketOf } from './plugins.ts';

// settings.json: the keys the installer reads or writes; every other key passes through untouched.
export interface Settings {
  permissions?: { allow?: string[]; deny?: string[]; [key: string]: unknown };
  sandbox?: Record<string, unknown>;
  statusLine?: { command?: string; [key: string]: unknown };
  hooks?: { PreToolUse?: HookEntry[]; [key: string]: unknown };
  extraKnownMarketplaces?: Record<
    string,
    { source?: Record<string, unknown>; autoUpdate?: boolean; [key: string]: unknown }
  >;
  enabledPlugins?: Record<string, boolean>;
  env?: Record<string, string>;
  theme?: string;
  cleanupPeriodDays?: number;
  [key: string]: unknown;
}
interface HookEntry {
  hooks?: { command?: string }[];
}
// statusLine: missing reads as off.
export interface Toggles {
  statusLine?: boolean;
  version: string;
  webBuiltinsOff?: boolean;
}

const PERMISSION = 'Read(~/.claude/plugins/**)';
const STATUS_LINE = { type: 'command', command: 'ccstatusline', padding: 0 };
// Always denied. Claude Code's sandbox, when on, also blocks Bash reads of these, except the ** globs it can't apply
// on Linux; the ./ dotenv names cover the project root there.
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
// The sandbox keys our old sandbox toggle wrote; excludedCommands, network etc. stay the user's.
const OLD_SANDBOX = ['enabled', 'autoAllowBashIfSandboxed', 'allowUnsandboxedCommands'];

export const isOurStatusLine = (s: Settings['statusLine']) =>
  typeof s?.command === 'string' && s.command.includes('ccstatusline');

// The program a hook command runs. dcg's installers write a bare path (Linux) or `& '<path>'` (Windows, a PowerShell
// call with '' for a quote); older ones wrote "<path>".
const hookProgram = (command: string) => {
  const c = command.trim().replace(/^&\s*/, '');
  const quoted = /^'((?:[^']|'')*)'|^"([^"]*)"/.exec(c);
  return quoted ? (quoted[2] ?? quoted[1].replaceAll("''", "'")) : c.split(/\s+/)[0];
};

export const hasDcgHook = (s: Settings) =>
  (s?.hooks?.PreToolUse ?? []).some((e) =>
    e?.hooks?.some((h) =>
      /^dcg(\.exe)?$/i.test(
        hookProgram(h?.command ?? '')
          .split(/[\\/]/)
          .pop()!,
      ),
    ),
  );

const KEEP_SESSIONS_DAYS = 36500;

// True when text is JSON equal to any shipped config text (whitespace-insensitive).
export const isShipped = (text: string, shippedTexts: string[]) => {
  try {
    const cur = JSON.stringify(JSON.parse(text));
    return shippedTexts.some((s) => JSON.stringify(JSON.parse(s)) === cur);
  } catch {
    return false;
  }
};

const WEB_BUILTINS = ['WebFetch', 'WebSearch'];
export const isWebBuiltinsOff = (s: Settings) => WEB_BUILTINS.every((d) => s?.permissions?.deny?.includes(d));

// The built-in web tools' new state: true deny them, false allow them again, undefined leave them.
// toggle: the choice; was: it was on before; healthy: SearXNG answered JSON; installed: web-mcp was installed before
// this run (only then can the denies be ours; someone who never had web-mcp keeps theirs).
// Only an explicit on to off allows them again: a down SearXNG must not undo denies that are already there.
export const webBuiltinsDecision = ({
  toggle,
  was,
  healthy,
  installed,
}: {
  toggle: boolean;
  was: boolean;
  healthy: boolean;
  installed?: boolean;
}) => (toggle ? healthy || undefined : was && installed ? false : undefined);

export function mergeSettings(settings: Settings, { statusLine, version, webBuiltinsOff }: Toggles) {
  const out = structuredClone(settings);
  // Night City ships with the bundle. Claude Code colours code in a fixed Monokai a theme can't change; off, diffs take
  // Night City's own diff colours.
  out.syntaxHighlightingDisabled = true;
  // Inside tmux Claude Code draws in 256 colours unless told otherwise, which turns the theme's indigos grey. Outside
  // tmux (and on Windows, which has none) the variable does nothing.
  out.env = { ...out.env, CLAUDE_CODE_TMUX_TRUECOLOR: '1' };
  // The theme's id carries its plugin's name, and night-city became part of dead-skills.
  if (out.theme === 'custom:night-city:night-city') out.theme = 'custom:dead-skills:night-city';
  // dead-skills raises its own popups; Claude Code's built-in one would double them.
  out.preferredNotifChannel = 'notifications_disabled';
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
  if (out.sandbox) {
    for (const k of OLD_SANDBOX) delete out.sandbox[k];
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

// The command that puts a clean slate's backup back, for the shell people use on platform.
export const restoreHint = (platform: string, backupDir: string, config: string) =>
  platform === 'win32'
    ? `Copy-Item -Recurse -Force '${backupDir.replaceAll("'", "''")}\\*' '${config.replaceAll("'", "''")}'`
    : `cp -a '${backupDir}/.' '${config}/'`;

export const isStripped = (s: Settings) => Object.entries(STRIP).every(([k, v]) => s?.[k] === v);

// One-way: unchecking it later changes nothing, since these keys are often set by hand too.
export function stripDefaults(settings: Settings): Settings {
  const out = { ...structuredClone(settings), ...STRIP };
  out.enabledPlugins = { ...out.enabledPlugins, ...STRIP_PLUGINS };
  // Another marketplace listed here would be re-added on the next launch.
  for (const name of foreignMarketplaces(Object.keys(out.extraKnownMarketplaces ?? {})))
    delete out.extraKnownMarketplaces![name];
  return out;
}

// Clean slate: only our settings survive, plus the official marketplace's entry and enabledPlugins entries from ours
// and it (claude plugin install writes them; strip already uninstalled the official plugins we don't use)
// and dcg's hook while dcg stays on (its installer only reruns on a toggle change, so dropping it would disable dcg).
export function resetSettings(settings: Settings, { dcg, ...toggles }: Toggles & { dcg?: boolean }) {
  const out = stripDefaults(mergeSettings({}, toggles));
  for (const [id, v] of Object.entries(settings.enabledPlugins ?? {})) {
    if ([MARKETPLACE, OFFICIAL].includes(marketOf(id))) out.enabledPlugins![id] = v;
  }
  const official = settings.extraKnownMarketplaces?.[OFFICIAL];
  if (official) out.extraKnownMarketplaces![OFFICIAL] = official;
  if (dcg && hasDcgHook(settings)) {
    out.hooks = { PreToolUse: settings.hooks!.PreToolUse!.filter((e) => hasDcgHook({ hooks: { PreToolUse: [e] } })) };
  }
  return out;
}

// settings.json as written back over raw: two-space JSON with raw's line endings.
export const settingsText = (raw: string, obj: unknown) => {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return JSON.stringify(obj, null, 2).replaceAll('\n', eol) + eol;
};

// What writing build(settings) over raw changes: undefined when raw isn't JSON, null when nothing changes.
export function settingsChange(raw: string, build: (s: Settings) => Settings) {
  let before: Settings;
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
