// Vendor K-Dense-AI/scientific-agent-skills' paper-lookup skill into its own plugin, trimmed for computer science:
// the biomedical sources (and ROR, Figshare) lose their reference files and table rows, a note under the title covers
// leftover mentions in prose, the description is replaced, and the "Citing Scientific Agent Skills" section (it asks
// Claude to cite upstream's paper in the user's work) is removed.
// Idempotent: re-running against the same upstream commit produces no diff.
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fail, finish, git, sparseClone } from './sync-lib.mjs';

const UPSTREAM_URL = 'https://github.com/K-Dense-AI/scientific-agent-skills.git';
const DEST = join(ROOT, 'plugins', 'shared', 'paper-lookup', 'skills', 'paper-lookup');

// references/<file>.md → the name upstream's tables use for it.
export const DROPPED = {
  pubmed: 'PubMed',
  pmc: 'PMC',
  europepmc: 'Europe PMC',
  biorxiv: 'bioRxiv',
  medrxiv: 'medRxiv',
  pubtator: 'PubTator3',
  biostudies: 'BioStudies',
  ror: 'ROR',
  figshare: 'Figshare',
};
const NAMES = [...Object.values(DROPPED), 'NCBI'];

// Plain YAML scalar: no ": " and no leading quote.
const DESCRIPTION =
  'Searches scholarly APIs for computer-science papers, preprints, citations and open-access full text, with reproducible provenance. Covers arXiv, Semantic Scholar, OpenAlex, Crossref, OpenCitations, Unpaywall, CORE, DOAJ and Zenodo. Use when searching for papers, DOI or arXiv lookups, abstracts, full text, open-access PDFs, citation graphs, author publications, or research software and datasets on Zenodo. Triggers on requests like "find papers on X", "look up this DOI", "who cites this paper", or "get me the PDF".';

const NOTE = `> **Trimmed for computer science.** This copy has no reference files for ${Object.values(DROPPED).join(', ')}. Any mention of them below is left over from upstream: don't call those services; use arXiv, Semantic Scholar, OpenAlex, Crossref, OpenCitations, Unpaywall, CORE, DOAJ or Zenodo.`;

// A table row goes when its first or second cell names a dropped source (a use case's primary database, an identifier
// or a database's own row). Mentions in later cells ("also consider") stay; the note covers them.
const dropsRow = (line) =>
  line
    .split('|')
    .slice(1, 3)
    .some((c) => NAMES.some((n) => c.trim().startsWith(n)));

// Returns the trimmed SKILL.md, or null when its frontmatter description or title isn't where we expect it.
export function trimSkill(text) {
  if (!/^description: .*$/m.test(text) || !/^# .*$/m.test(text)) return null;
  const out = text
    .replace(/^description: .*$/m, () => `description: ${DESCRIPTION}`)
    .replace(/^# .*$/m, (h) => `${h}\n\n${NOTE}`)
    .replace(/\n## Citing Scientific Agent Skills\n[\s\S]*?(?=\n## |$)/, '')
    .split('\n')
    .filter((l) => !(l.startsWith('|') && dropsRow(l)))
    .join('\n');
  return out.trimEnd() + '\n';
}

function main() {
  const up = sparseClone(UPSTREAM_URL, ['skills/paper-lookup']);
  const SRC = join(up, 'skills', 'paper-lookup');
  if (!existsSync(join(SRC, 'SKILL.md'))) fail('upstream skills/paper-lookup/SKILL.md not found');
  // A copied symlink would point outside the plugin once installed.
  for (const f of readdirSync(SRC, { recursive: true })) {
    if (lstatSync(join(SRC, f)).isSymbolicLink()) fail(`upstream skills/paper-lookup/${f} is a symlink`);
  }

  rmSync(DEST, { recursive: true, force: true });
  cpSync(SRC, DEST, { recursive: true });
  cpSync(join(up, 'LICENSE.md'), join(DEST, 'LICENSE.md'));
  for (const f of Object.keys(DROPPED)) rmSync(join(DEST, 'references', `${f}.md`), { force: true });

  const out = trimSkill(readFileSync(join(DEST, 'SKILL.md'), 'utf8'));
  if (out === null) fail('unexpected SKILL.md shape upstream (no description: line or # title)');
  if (out.includes('Citing Scientific Agent Skills')) fail('could not strip the citing section from SKILL.md');
  const left = Object.keys(DROPPED).filter((f) => out.includes(`references/${f}.md`));
  if (left.length) fail(`SKILL.md still points at dropped references: ${left.join(', ')}`);
  writeFileSync(join(DEST, 'SKILL.md'), out);

  finish('paper-lookup', git('-C', up, 'rev-parse', 'HEAD'), join(DEST, 'UPSTREAM'), DEST);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
