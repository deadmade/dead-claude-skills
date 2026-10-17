export type Run = {
  slug: string;
  path: string; // absolute
  mtimeMs: number;
  research: boolean; // frontmatter flow: research
  phase: string; // frontmatter phase:, '?' when missing
  gates: [string | null, string | null]; // approved date (YYYY-MM-DD) or null = open
  deviations: boolean;
};

export type Band = { run: Run; lines: string[]; showKey: boolean; command: string | null };

declare module 'claude-code' {
  interface PluginState {
    'feature-flow': { band: Band | null };
  }
}
