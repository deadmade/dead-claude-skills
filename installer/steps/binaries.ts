// tui-review and web-mcp, the binaries of tui-review and web-mcp: one on PATH is used as is; otherwise the release for
// this version goes to ~/.claude/bin and the plugin's userConfig key points at it.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BIN_PLUGINS, binAction, binAsset } from '../core/binaries.ts';
import { MARKETPLACE } from '../core/release.ts';
import { CONFIG, VERSION, WIN, done, failures } from '../context.ts';
import { downloadBin } from '../system/net.ts';
import { claude, onPath } from '../system/proc.ts';
import { progress } from '../ui/ui.ts';

export const TUI_REVIEW = `tui-review@${MARKETPLACE}`;
export const WEB_MCP = `web-mcp@${MARKETPLACE}`;
export const BIN_DIR = join(CONFIG, 'bin');

// The version a binary reports (`<name> <version>`), or undefined when there is none or it does not run.
function binVersionAt(name: string, path: string) {
  if (!existsSync(path)) return undefined;
  const r = spawnSync(path, ['--version'], { encoding: 'utf8' });
  return new RegExp(`^${name} (\\S+)`).exec(r.stdout ?? '')?.[1];
}

export async function applyBin(pluginName: string, plugin: string) {
  const { name, key } = BIN_PLUGINS[pluginName];
  const version = VERSION;
  const asset = binAsset(name, process.platform, process.arch, version);
  const bin = join(BIN_DIR, asset?.exe ?? (WIN ? `${name}.exe` : name));
  const action = binAction({
    onPath: onPath(name),
    installed: binVersionAt(name, bin),
    version,
    supported: asset !== undefined,
  });
  const build = `build it with \`cargo build --release\` in crates/${pluginName === 'web-mcp' ? 'web-mcp' : 'tui-review'} and set its path with /plugin configure ${pluginName}`;
  if (action === 'skip') return done.push(`${name}: using the one on PATH`);
  if (action === 'unsupported')
    return failures.push(`${name}: no release build for ${process.platform}-${process.arch}; ${build}`);
  if (action === 'download') {
    const r = await progress(`Downloading ${name} ${version}`, async () => {
      await downloadBin(name, asset!, bin);
      return { ok: true };
    });
    if (!r.ok) return failures.push(`${name} ${version}: ${r.err}; ${build}`);
    done.push(`installed ${name} ${version} to ${bin}`);
  }
  const r = await claude(JSON.stringify({ [key]: bin }), 'plugin', 'configure', plugin, '--values-stdin');
  if (r.ok) done.push(`${pluginName}: ${key} is ${bin}`);
  else
    failures.push(
      `${pluginName}: could not set ${key} (${r.err}); set it to ${bin} with /plugin configure ${pluginName}`,
    );
}
