// The open document: its absolute path, the text drawn (links rewritten, cut) or why it can't be shown.
export type Doc = {
  path: string;
  shown: string | null;
  hrefs: string[];
  error: string | null;
  mtimeMs: number;
  size: number;
};

declare module 'claude-code' {
  interface PluginState {
    'md-pane': { doc: Doc | null };
  }
}
