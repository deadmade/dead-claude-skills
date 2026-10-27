import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CLOSING = 'Fix what makes the prose worse for a reader. Leave a sentence as is when the finding is wrong.';

test('hooks.json declares both checks for Write and Edit of Markdown', () => {
  const config = JSON.parse(readFileSync(new URL('./hooks.json', import.meta.url), 'utf8'));
  const entries = config.hooks.PostToolUse;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].matcher, 'Write|Edit');
  const handlers = entries[0].hooks;
  assert.equal(handlers.length, 4);

  const prompts = [];
  for (const tool of ['Write', 'Edit']) {
    const rule = `${tool}(**/*.md)`;
    const command = handlers.filter((h) => h.type === 'command' && h.if === rule);
    assert.equal(command.length, 1);
    assert.equal(command[0].command, 'node');
    assert.deepEqual(command[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/prose-check.mjs']);

    const prompt = handlers.filter((h) => h.type === 'prompt' && h.if === rule);
    assert.equal(prompt.length, 1);
    assert.equal(prompt[0].model, 'claude-haiku-5-5');
    assert.equal(prompt[0].continueOnBlock, true);
    assert.equal(prompt[0].timeout, 30);
    prompts.push(prompt[0].prompt);
  }
  assert.equal(prompts[0], prompts[1]);
  assert.ok(prompts[0].includes(CLOSING));
  assert.ok(prompts[0].includes('$ARGUMENTS'));
});
