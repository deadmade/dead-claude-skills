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
