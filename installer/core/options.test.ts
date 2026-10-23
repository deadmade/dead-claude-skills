import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { optIns, manifestPath, INCLUDED, BUNDLE, type Marketplace, type PluginJson } from './plugins.ts';
import { dcgCommand, CATEGORIES, TOGGLES, categorize, unavailable, searxngRun, searxngSettings } from './options.ts';

const json = (p: string) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const marketplace: Marketplace = json('.claude-plugin/marketplace.json');
const bundle: PluginJson & { dependencies: string[] } = json(manifestPath(marketplace, BUNDLE)!);
const M = 'dead-claude-skills';

test('dcg runs its own installer per OS', () => {
  const [win, winArgs] = dcgCommand('win32', 'install');
  assert.equal(win, 'powershell');
  assert.match(winArgs.at(-1)!, /install\.ps1'\)\)\) -EasyMode -Verify$/);
  assert.match(dcgCommand('win32', 'uninstall')[1].at(-1)!, /uninstall\.ps1/);
  const [sh, shArgs] = dcgCommand('linux', 'install');
  assert.equal(sh, 'bash');
  assert.match(shArgs[1], /^set -o pipefail; curl /);
  assert.match(shArgs[1], /install\.sh' \| bash -s -- --verify$/);
  assert.match(dcgCommand('linux', 'uninstall')[1][1], /uninstall\.sh' \| bash -s -- --yes$/);
});

test('every opt-in and toggle is on exactly one page, except the INCLUDED ones on none', () => {
  const keys = [...optIns(marketplace, bundle), ...TOGGLES];
  const pages = categorize(keys);
  const shown = keys.filter((k) => !INCLUDED.includes(k.split('@')[0]));
  assert.deepEqual(pages.flatMap((p) => p.keys).sort(), shown.sort());
  assert.ok(!pages.some((p) => p.id === 'other'), 'every real opt-in has a category');
  const listed = CATEGORIES.flatMap((c) => c.keys);
  assert.equal(new Set(listed).size, listed.length);
});

test('an uncategorized plugin lands in Other, empty pages are dropped', () => {
  const pages = categorize([`new-thing@${M}`, 'dcg']);
  assert.deepEqual(
    pages.map((p) => [p.id, p.keys]),
    [
      ['system', ['dcg']],
      ['other', [`new-thing@${M}`]],
    ],
  );
});

test('the language servers page is Languages and lists the language skills', () => {
  const lang = CATEGORIES.find((c) => c.id === 'lsp')!;
  assert.equal(lang.title, 'Languages');
  for (const k of ['csharp-skills', 'rust-skills', 'csharp-lsp', 'rust-analyzer-lsp']) assert.ok(lang.keys.includes(k));
});

test('the Databases page follows Languages and lists postgres', () => {
  const i = CATEGORIES.findIndex((c) => c.id === 'database');
  assert.ok(i > 0);
  assert.equal(CATEGORIES[i].title, 'Databases');
  assert.ok(CATEGORIES[i].keys.includes('postgres'));
  assert.equal(CATEGORIES[i - 1].id, 'lsp');
});

test('categorize keeps bulk:false on danger', () => {
  assert.equal(categorize(['strip-defaults', 'clean']).find((c) => c.id === 'danger')!.bulk, false);
});

test('options hidden per platform', () => {
  assert.ok(unavailable(`nix-lsp@${M}`, 'win32', 'x64', '1.0.0'));
  assert.equal(unavailable(`tui-review@${M}`, 'win32', 'x64', '1.0.0'), undefined);
  assert.ok(unavailable(`tui-review@${M}`, 'win32', 'arm64', '1.0.0'));
  assert.ok(unavailable(`tui-review@${M}`, 'darwin', 'arm64', '1.0.0'));
  assert.ok(unavailable(`tui-review@${M}`, 'linux', 'arm64', '1.0.0'));
  for (const k of [`nix-lsp@${M}`, 'dcg']) {
    assert.equal(unavailable(k, 'linux', 'x64', '1.0.0'), undefined);
    assert.equal(unavailable(k, 'darwin', 'arm64', '1.0.0'), undefined);
  }
  assert.equal(unavailable(`tui-review@${M}`, 'linux', 'x64', '1.0.0'), undefined);
});

test('searxng binds loopback, mounts the config dir and takes the secret', () => {
  const args = searxngRun('/c/searxng');
  assert.ok(args.includes('127.0.0.1:8888:8080'));
  assert.ok(args.includes('/c/searxng:/etc/searxng/'));
  const tpl = readFileSync(new URL('../assets/searxng.yml', import.meta.url), 'utf8');
  const out = searxngSettings(tpl, 'abc123');
  assert.match(out, /secret_key: "abc123"/);
  assert.doesNotMatch(out, /changeme/);
  assert.match(out, /- json/);
  // \r?: Windows checkouts turn the template's line endings into CRLF.
  assert.match(out, /name: bing\r?\n\s+disabled: false/);
  for (const e of ['duckduckgo', 'brave', 'google cse'])
    assert.match(out, new RegExp(`name: ${e}\\r?\\n\\s+disabled: true`));
});
