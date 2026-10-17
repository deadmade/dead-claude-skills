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

// Lines from "## <title>" to the next "## ".
function sectionOf(lines: string[], title: string): string[] {
  const from = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (from < 0) return [];
  const len = lines.slice(from + 1).findIndex((l) => l.startsWith('## '));
  return lines.slice(from + 1, len < 0 ? undefined : from + 1 + len);
}

// The "**Claim:**" bullet of a spec's ## Hypothesis section.
export function claimOf(spec: string): string | null {
  for (const l of sectionOf(spec.split(/\r?\n/), 'Hypothesis')) {
    const m = /^- \*\*Claim:\*\*[ \t]*(.+?)[ \t]*$/.exec(l);
    if (m) return m[1]!;
  }
  return null;
}

export function parseFlow(text: string): Omit<Run, 'slug' | 'path' | 'mtimeMs'> {
  const lines = text.split(/\r?\n/);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const field = (key: string) => new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(fm)?.[1];

  const section = (title: string) => sectionOf(lines, title);
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

  const spec = /^- Spec:\s*\[[^\]]*\]\(([^)\s]+)\)/.exec(
    section('Artifacts').find((l) => l.startsWith('- Spec:')) ?? '',
  )?.[1];
  const results = section('Results');
  // The "numbers" cell (3rd column) of the table row named `name`.
  const numbers = (name: string) =>
    results
      .find((l) => l.split('|')[1]?.trim() === name)
      ?.split('|')[3]
      ?.trim() ?? '';
  const verdict = results
    .map((l) => /^Verdict:\s*(not supported|supported|inconclusive)\b(?!\s*\|)/.exec(l)?.[1])
    .find(Boolean);

  return {
    spec: spec ?? null,
    baseline: numbers('baseline'),
    feature: numbers('feature'),
    verdict: (verdict as Run['verdict']) ?? null,
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

// Drops segments from the right, then cuts the first one.
function fit(segs: string[], room: number): string {
  let line = segs.join(' · ');
  while (line.length > room && segs.length > 1) {
    segs.pop();
    line = segs.join(' · ');
  }
  return line.length > room ? `${line.slice(0, room - 1)}…` : line;
}

// Each line within columns - 10 (room for the key, drawn elsewhere). A research run adds a line: claim, results, verdict.
export function bandLines(run: Run, others: number, columns: number, claim: string | null = null): string[] {
  const segs = [run.slug, run.phase, gateText(1, run.gates[0]), gateText(2, run.gates[1])];
  if (run.deviations) segs.push('deviations');
  if (others > 0) segs.push(`+${others} open`);
  const room = Math.max(columns - 10, 1);
  const lines = [fit(segs, room)];
  if (run.research) {
    const second = [
      claim,
      run.baseline && `baseline ${run.baseline}`,
      run.feature && `feature ${run.feature}`,
      run.verdict,
    ].filter((s): s is string => !!s);
    if (second.length) lines.push(fit(second, room));
  }
  return lines;
}

export function resumeCommand(commands: CommandInfo[], research: boolean): string | null {
  const tail = research ? 'research-flow' : 'feature-flow';
  const hit = commands.find(
    (c) => (c.plugin === 'feature-flow' || c.name.startsWith('feature-flow:')) && c.name.endsWith(tail),
  );
  return hit?.name ?? null;
}
