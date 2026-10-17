// Plugin folders as repo-relative `/` paths. A GROUPS folder holds plugins (or another GROUPS folder) one level down
// and is not one itself.
// A folder without a manifest is skipped: a checkout keeps ignored build output in folders a move left behind.
import { existsSync, readdirSync } from 'node:fs';

export const GROUPS = ['shared', 'opt-in', 'opt-in/mcp', 'opt-in/implementation'];

export function pluginDirs(root = '.') {
  const subdirs = (rel) =>
    readdirSync(`${root}/${rel}`, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${rel}/${d.name}`);
  const expand = (p) => (GROUPS.includes(p.slice('plugins/'.length)) ? subdirs(p).flatMap(expand) : [p]);
  return subdirs('plugins')
    .flatMap(expand)
    .filter((p) => existsSync(`${root}/${p}/.claude-plugin/plugin.json`))
    .sort();
}
