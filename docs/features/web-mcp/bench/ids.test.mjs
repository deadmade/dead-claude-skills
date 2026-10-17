import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { claudeArgs, claudeEnv, norm } from './baseline.mjs';
import { ids, primaryIds } from './ids.mjs';

test('ids', () => {
  assert.deepEqual(ids('see 10.1038/NATURE12373. and arXiv:1706.03762v5'), ['10.1038/nature12373', '1706.03762']);
  assert.deepEqual(ids(''), []);
});

test('primaryIds takes the first record only', () => {
  const crossref = { message: { DOI: '10.1038/nature12373', reference: [{ DOI: '10.1/x' }] } };
  assert.deepEqual(primaryIds('crossref doi', JSON.stringify(crossref)), ['10.1038/nature12373']);
  const s2 = { externalIds: { DOI: '10.5555/3295222.3295349', ArXiv: '1706.03762' } };
  assert.deepEqual(primaryIds('semantic scholar arxiv id', JSON.stringify(s2)), [
    '10.5555/3295222.3295349',
    '1706.03762',
  ]);
  const arxiv = {
    entries: [
      { arxiv_id: '1706.03762', doi: null },
      { arxiv_id: '2001.00001', doi: '10.1/y' },
    ],
  };
  assert.deepEqual(primaryIds('arxiv search', JSON.stringify(arxiv)), ['1706.03762']);
  const oa = { works: [{ doi: 'https://doi.org/10.7717/peerj.4375' }, { doi: 'https://doi.org/10.1/z' }] };
  assert.deepEqual(primaryIds('openalex search', JSON.stringify(oa)), ['10.7717/peerj.4375']);
  assert.deepEqual(primaryIds('openalex search', 'not json'), []);
});

test('norm strips markdown link targets', () => {
  assert.equal(norm('see [the docs](https://x.y/z) now'), 'see the docs now');
});

test('web-mcp target loads the plugin and puts the binary on PATH', () => {
  assert.deepEqual(claudeArgs('web-mcp', '/r'), ['--plugin-dir', '/r/plugins/mcp/web-mcp']);
  assert.deepEqual(claudeArgs('builtin', '/r'), []);
  assert.equal(claudeEnv('web-mcp', '/x/bin/web-mcp', { PATH: '/usr/bin' }).PATH, `/x/bin${path.delimiter}/usr/bin`);
  const env = { PATH: '/usr/bin' };
  assert.equal(claudeEnv('builtin', null, env), env);
});
