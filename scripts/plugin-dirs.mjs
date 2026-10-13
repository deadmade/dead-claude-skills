// Plugin folders as repo-relative `/` paths. A GROUPS folder holds plugins one level down and is not one itself.
import { readdirSync } from 'node:fs';

export const GROUPS = ['languages'];

export function pluginDirs(root = '.') {
  const subdirs = (rel) =>
    readdirSync(`${root}/${rel}`, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${rel}/${d.name}`);
  return subdirs('plugins')
    .flatMap((p) => (GROUPS.includes(p.slice('plugins/'.length)) ? subdirs(p) : [p]))
    .sort();
}
