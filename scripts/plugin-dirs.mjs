// Plugin folders as repo-relative `/` paths. A GROUPS folder holds plugins one level down and is not one itself.
// A folder without a manifest is skipped: a checkout keeps ignored build output in folders a move left behind.
import { existsSync, readdirSync } from 'node:fs';

export const GROUPS = ['default', 'shared', 'opt-in'];

export function pluginDirs(root = '.') {
  const subdirs = (rel) =>
    readdirSync(`${root}/${rel}`, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${rel}/${d.name}`);
  return subdirs('plugins')
    .flatMap((p) => (GROUPS.includes(p.slice('plugins/'.length)) ? subdirs(p) : [p]))
    .filter((p) => existsSync(`${root}/${p}/.claude-plugin/plugin.json`))
    .sort();
}
