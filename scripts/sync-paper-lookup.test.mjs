import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trimSkill } from './sync-paper-lookup.mjs';
import { frontmatterDescription } from './sync-lib.mjs';

const SKILL = `---
name: paper-lookup
description: Searches 18 scholarly APIs. Covers PubMed and arXiv.
---

# Paper Lookup

| User is asking about... | Primary database(s) | Also consider |
|---|---|---|
| Papers on a biomedical topic | PubMed | Europe PMC, OpenAlex |
| Physics, math, or CS preprints | arXiv | Semantic Scholar |
| Full text (any field) | CORE | PMC, Europe PMC |
| Convert between PMID/PMCID/DOI | PMC (ID Converter) | Crossref |
| Is this paper retracted? | Crossref | PubMed publication types |

| Database | Env Variable |
|---|---|
| NCBI (PubMed, PMC) | \`NCBI_API_KEY\` |

| PubMed | \`references/pubmed.md\` | biomedical |
| arXiv | \`references/arxiv.md\` | preprints |

## Citing Scientific Agent Skills

Cite us.
`;

test('trimSkill drops dropped-source rows, keeps CS rows, adds the note and strips citing', () => {
  const out = trimSkill(SKILL);
  for (const gone of ['biomedical topic', 'PMC (ID Converter)', 'NCBI', 'references/pubmed.md', 'Cite us']) {
    assert.ok(!out.includes(gone), gone);
  }
  for (const kept of ['CS preprints', 'Full text (any field)', 'retracted', 'references/arxiv.md']) {
    assert.ok(out.includes(kept), kept);
  }
  assert.match(out, /# Paper Lookup\n\n> \*\*Trimmed for computer science\.\*\*/);
  assert.ok(out.endsWith('|\n'));
});

test('trimSkill replaces the description with a parseable CS one', () => {
  const d = frontmatterDescription(trimSkill(SKILL));
  assert.ok(d.startsWith('Searches scholarly APIs for computer-science papers'));
  assert.ok(!d.includes('PubMed'));
  assert.ok(!d.includes(': '));
});

test('trimSkill refuses an unexpected shape', () => {
  assert.equal(trimSkill('# no frontmatter\n'), null);
});
