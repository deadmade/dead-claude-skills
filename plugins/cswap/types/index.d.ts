export type Window = { pct: number; countdown: string | null };

export type Account = {
  number: number;
  label: string;
  active: boolean;
  disabled: boolean;
  status: string;
  fiveHour: Window | null;
  sevenDay: Window | null;
};

export type View = {
  accounts: Account[];
  error: string | null;
  missing: boolean;
  updatedAt: number;
};

declare module 'claude-code' {
  interface PluginState {
    cswap: { view: View };
  }
}
