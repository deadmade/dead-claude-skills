import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BINLOG_MCP,
  ROUTERS,
  assignRouter,
  dropBinlogMcp,
  entrySummary,
  isHidden,
  renderRouter,
} from './sync-csharp.mjs';
import { frontmatterDescription } from './sync-lib.mjs';

test('assignRouter maps upstream plugins to routers, unknown ones to core', () => {
  assert.equal(assignRouter('dotnet-blazor'), 'web');
  assert.equal(assignRouter('dotnet-test-migration'), 'testing');
  assert.equal(assignRouter('dotnet-brand-new'), 'core');
});

test('no upstream plugin is in two routers', () => {
  const all = ROUTERS.flatMap((r) => r.plugins);
  assert.equal(new Set(all).size, all.length);
});

test('renderRouter sorts entries, escapes pipes and keeps the description parseable', () => {
  const description = ROUTERS.find((r) => r.name === 'testing').description;
  const out = renderRouter({
    name: 'testing',
    description,
    entries: [
      { name: 'b', summary: 'x | y' },
      { name: 'a', summary: 'z' },
    ],
  });
  assert.ok(out.indexOf('| a |') < out.indexOf('| b |'));
  assert.ok(out.includes('x \\| y'));
  assert.ok(out.includes('`${CLAUDE_PLUGIN_ROOT}/library/a/SKILL.md`'));
  assert.ok(out.includes('name: testing'));
  assert.equal(frontmatterDescription(out), description);
});

test('isHidden reads disable-model-invocation', () => {
  assert.equal(isHidden('---\nname: f\ndisable-model-invocation: true\nuser-invocable: false\n---'), true);
  assert.equal(isHidden('---\nname: f\nuser-invocable: false\n---'), false);
});

test('entrySummary overrides csharp-expert and summarizes the rest', () => {
  assert.equal(
    entrySummary('csharp-expert', 'Route C# requests to the smallest marketplace plugin. More.'),
    'C# semantics, and routing to the right specialist skill in this plugin.',
  );
  assert.equal(entrySummary('other', 'First sentence. Second.'), 'First sentence.');
});

test('dropBinlogMcp drops the MCP sections, keeps the replay ones and ignores headings in code', () => {
  const text = [
    '## Analyze',
    '### Primary: binlog MCP (preferred)',
    'Use the server.',
    '#### Step',
    'more MCP.',
    '### Fallback: text-log replay (when MCP is unavailable)',
    '```bash',
    '# not a heading',
    '```',
    '## Primary workflow — binlog MCP',
    '```bash',
    '## also not a heading',
    '```',
    'MCP steps.',
    '## Fallback workflow — diagnostic log (when MCP is unavailable)',
    'Replay.',
  ].join('\n');
  assert.equal(
    dropBinlogMcp(text),
    ['## Analyze', '### Text-log replay', '```bash', '# not a heading', '```', '## Diagnostic log', 'Replay.'].join(
      '\n',
    ),
  );
});

test('BINLOG_MCP leaves generic MCP server mentions alone', () => {
  assert.equal(BINLOG_MCP.test('Setting up publishing for a dotnet tool, MCP server, or template package'), false);
  assert.equal(BINLOG_MCP.test('Use this only when the MCP server cannot be started.'), true);
});
