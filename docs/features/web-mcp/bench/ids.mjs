// Paper identifiers in free text, and the identifiers of the first record of a baseline pipeline's output.

const DOI = /10\.\d{4,9}\/[^\s"<>]+/g;
const ARXIV = /\b(\d{4}\.\d{4,5})(?:v\d+)?\b/g;

export function ids(text) {
  const dois = (String(text).match(DOI) ?? []).map((d) => d.toLowerCase().replace(/[.,;)]+$/, ''));
  const arxiv = [...String(text).matchAll(ARXIV)].map((m) => m[1]);
  return [...new Set([...dois, ...arxiv])].sort();
}

// arxiv_atom.py prints {entries: [{arxiv_id, doi}]}; openalex_abstract.py prints {works: [{doi}]} with the DOI as a
// https://doi.org/ URL; Crossref and Semantic Scholar are the raw API bodies.
export function primaryIds(name, stdout) {
  let j;
  try {
    j = JSON.parse(stdout);
  } catch {
    return [];
  }
  const parts = name.startsWith('arxiv')
    ? [j.entries?.[0]?.arxiv_id, j.entries?.[0]?.doi]
    : name.startsWith('openalex')
      ? [j.works?.[0]?.doi]
      : name.startsWith('crossref')
        ? [j.message?.DOI]
        : [j.externalIds?.DOI, j.externalIds?.ArXiv];
  return ids(parts.filter(Boolean).join(' '));
}
