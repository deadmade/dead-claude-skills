export type Run = {
  slug: string;
  path: string; // absolute
  mtimeMs: number;
  flow: string; // frontmatter flow:, 'feature' when missing
  research: boolean; // flow: research
  phase: string; // frontmatter phase:, '?' when missing
  gates: [string | null, string | null]; // approved date (YYYY-MM-DD) or null = open
  deviations: boolean;
  spec: string | null; // research: link target of "- Spec:" under ## Artifacts, as written
  baseline: string; // research: the Results "numbers" cells, '' when empty or absent
  feature: string;
  verdict: 'supported' | 'not supported' | 'inconclusive' | null; // null while the Verdict line lists all three
};

// What the band draws; its line is laid out at render, to each surface's bodyColumns.
export type Band = {
  run: Run;
  others: number; // open runs besides this one
  showKey: boolean; // this session hasn't written this run's flow.md, and it isn't done
  command: string | null; // the resume command for this run's flow
  claim: string | null; // research: the spec's Hypothesis claim
};

declare module 'claude-code' {
  interface PluginState {
    flows: { band: Band | null };
  }
}
