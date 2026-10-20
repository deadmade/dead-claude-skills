// Re-pin one url-sourced marketplace plugin to its upstream's newest stable vX.Y.Z tag: `ref` is the tag, `sha` the
// commit it points to (peeled for annotated tags). Edits marketplace.json in place, like release.mjs, so the rest of the
// file keeps its formatting. Usage: node scripts/sync-plugins.mjs <name> <owner/repo>
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fail, git } from './sync-lib.mjs';

// Every stable vX.Y.Z tag in `git ls-remote --tags` output with its commit (peeled for annotated tags), oldest first.
export function stableTags(lsRemote) {
  const tags = new Map();
  for (const line of lsRemote.split('\n')) {
    const m = /^([0-9a-f]{40})\trefs\/tags\/(v(\d+)\.(\d+)\.(\d+))(\^\{\})?$/.exec(line);
    if (!m) continue;
    const [, sha, tag, ...rest] = m;
    const entry = tags.get(tag) ?? { tag, version: rest.slice(0, 3).map(Number) };
    if (rest[3] || !entry.sha) entry.sha = sha; // the peeled ^{} line wins
    tags.set(tag, entry);
  }
  const cmp = ({ version: a }, { version: b }) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return [...tags.values()].sort(cmp).map(({ tag, sha }) => ({ tag, sha }));
}

// The newest stable tag and its commit, or undefined when there is none.
export const newestTag = (lsRemote) => stableTags(lsRemote).at(-1);

// `text` with the entry for https://github.com/<repo>.git pinned to tag/sha, and the ref it had; undefined when that
// entry has no url/ref/sha lines.
export function pin(text, repo, tag, sha) {
  const url = `https://github.com/${repo}.git`.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`("url": "${url}",\\r?\\n\\s*"ref": )"([^"]*)"(,\\r?\\n\\s*"sha": )"[^"]*"`);
  const m = re.exec(text);
  if (!m) return undefined;
  return { text: text.replace(re, `$1"${tag}"$3"${sha}"`), old: m[2] };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name, repo] = process.argv.slice(2);
  if (!name || !repo) fail('usage: node scripts/sync-plugins.mjs <name> <owner/repo>');
  const latest = newestTag(git('ls-remote', '--tags', `https://github.com/${repo}.git`));
  if (!latest) fail(`${repo} has no vX.Y.Z tag`);
  const file = join(ROOT, '.claude-plugin', 'marketplace.json');
  const text = readFileSync(file, 'utf8');
  const pinned = pin(text, repo, latest.tag, latest.sha);
  if (!pinned) fail(`no pinned entry for https://github.com/${repo}.git in marketplace.json`);
  if (pinned.text !== text) writeFileSync(file, pinned.text);
  console.log(`${name}: ${pinned.old} -> ${latest.tag} (${latest.sha})`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${latest.tag}\nold=${pinned.old}\nsha=${latest.sha}\n`);
}
