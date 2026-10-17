import type { CommandInfo } from 'claude-code';

import type { Run } from '../types';

const DATE = /\d{4}-\d{2}-\d{2}/g;

// The approval date on a "- Gate N, ... approved: ..." line, or null while the gate is open or reopened.
// Compares match indices, not values: a reopen and its re-approval can carry the same date.
export function gateDate(line: string): string | null {
  const body = line.slice(line.indexOf(':') + 1);
  const dates = [...body.matchAll(DATE)].map((m) => ({ at: m.index!, date: m[0] }));
  const last = dates[dates.length - 1];
  if (!last) return null;
  const reopened = [...body.matchAll(/reopened/gi)].pop();
  if (!reopened) return last.date;
  const after = dates.find((d) => d.at > reopened.index!);
  return after && after.at !== last.at ? last.date : null;
}

export function parseFlow(text: string): Omit<Run, 'slug' | 'path' | 'mtimeMs'> {
  const lines = text.split(/\r?\n/);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const field = (key: string) => new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(fm)?.[1];

  // Lines from "## <title>" to the next "## ".
  const section = (title: string) => {
    const from = lines.findIndex((l) => l.trim() === `## ${title}`);
    if (from < 0) return [];
    const len = lines.slice(from + 1).findIndex((l) => l.startsWith('## '));
    return lines.slice(from + 1, len < 0 ? undefined : from + 1 + len);
  };
  const gate = (n: number) => {
    const line = section('Gates').find((l) => new RegExp(`^- Gate ${n}\\b`).test(l));
    return line ? gateDate(line) : null;
  };
  const first = section('Deviations')
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);

  return {
    research: field('flow') === 'research',
    phase: field('phase') || '?',
    gates: [gate(1), gate(2)],
    deviations: !!first && !/^(- )?none\b/i.test(first),
  };
}

export function slugOf(filePath: string): string | null {
  return /(?:^|\/)docs\/features\/([^/]+)\/flow\.md$/.exec(filePath.replace(/\\/g, '/'))?.[1] ?? null;
}

export function newest(copies: Run[]): Run[] {
  const by = new Map<string, Run>();
  for (const r of copies) if (r.mtimeMs > (by.get(r.slug)?.mtimeMs ?? -Infinity)) by.set(r.slug, r);
  return [...by.values()];
}

// The touched run wins even when done; otherwise the open run with the newest file.
export function pickCurrent(runs: Run[], touched: string | null): { current: Run | null; others: number } {
  const open = runs.filter((r) => r.phase !== 'done');
  const current =
    runs.find((r) => r.slug === touched) ??
    open.reduce<Run | null>((a, r) => (!a || r.mtimeMs > a.mtimeMs ? r : a), null);
  return { current, others: open.filter((r) => r !== current).length };
}

const gateText = (n: number, date: string | null) => (date ? `gate ${n} ✓ ${date.slice(5)}` : `gate ${n} –`);

// One line within columns - 10 (room for the key, drawn elsewhere): drops segments from the right, then cuts the slug.
export function bandLines(run: Run, others: number, columns: number): string[] {
  const segs = [run.slug, run.phase, gateText(1, run.gates[0]), gateText(2, run.gates[1])];
  if (run.deviations) segs.push('deviations');
  if (others > 0) segs.push(`+${others} open`);
  const room = Math.max(columns - 10, 1);
  let line = segs.join(' · ');
  while (line.length > room && segs.length > 1) {
    segs.pop();
    line = segs.join(' · ');
  }
  return [line.length > room ? `${line.slice(0, room - 1)}…` : line];
}

export function resumeCommand(commands: CommandInfo[], research: boolean): string | null {
  const tail = research ? 'research-flow' : 'feature-flow';
  const hit = commands.find(
    (c) => (c.plugin === 'feature-flow' || c.name.startsWith('feature-flow:')) && c.name.endsWith(tail),
  );
  return hit?.name ?? null;
}
