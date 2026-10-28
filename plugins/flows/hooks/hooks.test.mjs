import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('hooks.json runs the code check after a Write or Edit of Markdown and no model', () => {
  const text = readFileSync(new URL('./hooks.json', import.meta.url), 'utf8');
  assert.ok(!text.includes('"prompt"'));
  const config = JSON.parse(text);
  const entries = config.hooks.PostToolUse;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].matcher, 'Write|Edit');
  assert.deepEqual(entries[0].hooks, [
    { type: 'command', if: 'Write(**/*.md)', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/prose-check.mjs'] },
    { type: 'command', if: 'Edit(**/*.md)', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/prose-check.mjs'] },
  ]);
  assert.match(config.description, /FLOWS_PROSE_CHECK=off turns it off\.$/);
});

test('every script hooks.json runs exists', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const config = JSON.parse(readFileSync(new URL('./hooks.json', import.meta.url), 'utf8'));
  const args = Object.values(config.hooks).flatMap((entries) => entries.flatMap((e) => e.hooks.flatMap((h) => h.args)));
  assert.ok(args.length > 0);
  for (const arg of args) {
    assert.match(arg, /^\$\{CLAUDE_PLUGIN_ROOT\}\//);
    const path = arg.replace('${CLAUDE_PLUGIN_ROOT}', root);
    assert.ok(existsSync(path), path);
  }
});
