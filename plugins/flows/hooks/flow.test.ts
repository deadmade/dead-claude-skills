import { expect, test } from 'claude-code/testing';

import type { CommandInfo } from 'claude-code';

import type { Run } from '../types';
import { bandLines, claimOf, gateDate, newest, parseFlow, pickCurrent, resumeCommand, slugOf } from './flow';

const TEMPLATE = `---
phase: ground
---

# <Feature>: flow

## Request

<!-- The user's words, verbatim. -->

## Artifacts

- Spec:
- Plan:

## Gates

- Gate 1, spec approved:
- Gate 2, plan approved: <date>, execution: subagent-driven | native

## Skipped

<!-- Phases the user chose to skip, and why. -->

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
`;

const withDeviations = (body: string) => `---\nphase: execute\n---\n\n## Deviations\n\n${body}\n\n## Walkthrough\n`;

test('gateDate: open gates', () => {
  expect(gateDate('- Gate 1, spec approved:')).toBeNull();
  expect(gateDate('- Gate 2, plan approved: <date>, execution: subagent-driven | native')).toBeNull();
});

test('gateDate: approved', () => {
  expect(
    gateDate('- Gate 1, spec approved: 2026-10-13 ("go", in reply to "Do you approve the spec as written?")'),
  ).toBe('2026-10-13');
});

test('gateDate: three equal dates, re-approved last', () => {
  expect(
    gateDate(
      '- Gate 1, spec approved: 2026-10-13 ("approved, write the plan"). Reopened 2026-10-13: `paths` ignored for plugin skills; user chose router skills (D); re-approved 2026-10-13 ("approved, write the plan")',
    ),
  ).toBe('2026-10-13');
});

test('gateDate: reopened and not yet re-approved', () => {
  expect(gateDate('- Gate 1, spec approved: 2026-10-11. Reopened 2026-10-12: x changed')).toBeNull();
  expect(gateDate('- Gate 1, spec approved: 2026-10-11, reopened: spec changed')).toBeNull();
});

test('gateDate: reopened and re-approved', () => {
  expect(gateDate('- Gate 1, spec approved: 2026-10-11. reopened 2026-10-12, re-approved 2026-10-14')).toBe(
    '2026-10-14',
  );
});

test('parseFlow: the template', () => {
  expect(parseFlow(TEMPLATE)).toMatchObject({
    phase: 'ground',
    flow: 'feature',
    research: false,
    gates: [null, null],
    deviations: false,
  });
});

test('parseFlow: gates, phase and flow from frontmatter', () => {
  const text = TEMPLATE.replace('phase: ground', 'phase: plan\nflow: research').replace(
    '- Gate 1, spec approved:',
    '- Gate 1, spec approved: 2026-10-13 ("ok")',
  );
  expect(parseFlow(text)).toMatchObject({
    phase: 'plan',
    flow: 'research',
    research: true,
    gates: ['2026-10-13', null],
  });
});

test('parseFlow: no frontmatter gives phase ?', () => {
  expect(parseFlow('# x\n\n## Gates\n').phase).toBe('?');
});

test('parseFlow: deviations', () => {
  const dev = (b: string) => parseFlow(withDeviations(b)).deviations;
  expect(dev("None that change an interface or a task's files.")).toBe(false);
  expect(dev("- None to the plan's interfaces")).toBe(false);
  expect(dev('1. **Task 2: changed the signature**')).toBe(true);
  expect(dev('<!-- Where the plan changed.\nSecond line. -->')).toBe(false);
});

test('parseFlow: CRLF gives the same result', () => {
  const text = TEMPLATE.replace('- Gate 1, spec approved:', '- Gate 1, spec approved: 2026-10-13');
  expect(parseFlow(text.replace(/\n/g, '\r\n'))).toEqual(parseFlow(text));
  const dev = withDeviations('1. **Task 2: x**');
  expect(parseFlow(dev.replace(/\n/g, '\r\n'))).toEqual(parseFlow(dev));
});

const run = (slug: string, mtimeMs: number, phase = 'plan'): Run => ({
  slug,
  path: `/r/docs/features/${slug}/flow.md`,
  mtimeMs,
  flow: 'feature',
  research: false,
  phase,
  gates: ['2026-10-17', null],
  deviations: true,
  spec: null,
  baseline: '',
  feature: '',
  verdict: null,
});

test('slugOf', () => {
  expect(slugOf('/r/docs/features/flow-pane/flow.md')).toBe('flow-pane');
  expect(slugOf('C:\\r\\docs\\features\\flow-pane\\flow.md')).toBe('flow-pane');
  expect(slugOf('/r/docs/features/flow-pane/spec.md')).toBeNull();
});

test('newest: one run per slug, the greatest mtime', () => {
  const out = newest([run('a', 1), run('a', 2), run('b', 1)]);
  expect(out.map((r) => [r.slug, r.mtimeMs]).sort()).toEqual([
    ['a', 2],
    ['b', 1],
  ]);
});

test('pickCurrent', () => {
  const runs = [run('a', 1), run('b', 3), run('c', 2), run('x', 9, 'done')];
  expect(pickCurrent(runs, null)).toEqual({ current: runs[1], others: 2 });
  expect(pickCurrent(runs, 'x')).toEqual({ current: runs[3], others: 3 });
  expect(pickCurrent(runs, 'nope')).toEqual({ current: runs[1], others: 2 });
  expect(pickCurrent([run('x', 9, 'done')], null)).toEqual({ current: null, others: 0 });
  expect(pickCurrent([run('q', 1, '?')], null).current?.slug).toBe('q');
});

test('bandLines: wide', () => {
  const lines = bandLines(run('flow-pane', 1), 3, 100);
  expect(lines).toHaveLength(1);
  for (const s of ['flow-pane', 'plan', '10-17', 'deviations', '+3 open']) expect(lines[0]).toContain(s);
});

test('bandLines: narrow drops from the right, then cuts the slug', () => {
  const at = (cols: number) => bandLines(run('flow-pane', 1), 3, cols);
  for (const cols of [100, 70, 60, 50, 40, 25, 18]) {
    for (const l of at(cols)) expect(l.length).toBeLessThanOrEqual(cols - 10);
  }
  const mid = at(70).join('');
  expect(mid).toContain('deviations');
  expect(mid).not.toContain('+3 open');
  expect(at(40).join('')).not.toContain('deviations');
  expect(at(40).join('')).toContain('flow-pane');
  expect(at(18).join('')).toContain('…');
  expect(bandLines(run('flow-pane', 1), 0, 100)[0]).not.toContain('+0 open');
});

const RESEARCH = `---
flow: research
phase: validate
---

## Artifacts

- Spec: [spec.md](spec.md)
- Plan:

## Results

| run      | command | numbers | date |
| -------- | ------- | ------- | ---- |
| baseline | x       | 412ms   | d    |
| feature  | x       |         |      |

Verdict: supported | not supported | inconclusive. Threats that showed up. The user's decision.
`;

test('parseFlow: research spec link and results', () => {
  expect(parseFlow(RESEARCH)).toMatchObject({ spec: 'spec.md', baseline: '412ms', feature: '', verdict: null });
  expect(parseFlow(TEMPLATE)).toMatchObject({ spec: null, baseline: '', feature: '', verdict: null });
});

test('parseFlow: verdict', () => {
  const verdict = (line: string) => parseFlow(RESEARCH.replace(/Verdict:.*/, line)).verdict;
  expect(verdict('Verdict: supported')).toBe('supported');
  expect(verdict('Verdict: not supported. Threats showed up.')).toBe('not supported');
  expect(verdict('Verdict: inconclusive')).toBe('inconclusive');
  expect(verdict('Verdict: supported | not supported | inconclusive.')).toBeNull();
});

test('claimOf', () => {
  expect(claimOf('# S\n\n## Hypothesis\n\n- **Claim:** if we build X, p95 drops 30%\n- **Evidence:** E1\n')).toBe(
    'if we build X, p95 drops 30%',
  );
  expect(claimOf('# S\n\n## Goals\n\n- **Claim:** not here\n')).toBeNull();
  expect(claimOf('## Hypothesis\n\n- **Evidence:** E1\n')).toBeNull();
});

test('bandLines: research second line', () => {
  const r: Run = { ...run('rs', 1), flow: 'research', research: true, baseline: '412ms', verdict: 'supported' };
  const lines = bandLines(r, 0, 100, 'caching cuts p95');
  expect(lines).toHaveLength(2);
  for (const s of ['caching cuts p95', '412ms', 'supported']) expect(lines[1]).toContain(s);
  expect(lines[1]).not.toContain('feature');
  expect(bandLines(r, 0, 100)[1]).toBe('baseline 412ms · supported');
  expect(bandLines({ ...r, baseline: '', verdict: null }, 0, 100)).toHaveLength(1);
  expect(bandLines(r, 0, 30, 'caching cuts p95')[1]!.length).toBeLessThanOrEqual(20);
  expect(bandLines(run('f', 1), 0, 100, 'a claim')).toHaveLength(1);
});

test('resumeCommand', () => {
  const c = (name: string, plugin?: string): CommandInfo =>
    ({ name, description: '', source: 'plugin', plugin }) as CommandInfo;
  const cmds = [c('flows:feature-flow', 'flows'), c('flows:research-flow', 'flows')];
  expect(resumeCommand(cmds, 'feature')).toBe('flows:feature-flow');
  expect(resumeCommand(cmds, 'research')).toBe('flows:research-flow');
  expect(resumeCommand([c('flows:feature-flow'), c('flows:research-flow')], 'research')).toBe('flows:research-flow');
  expect(resumeCommand([c('other:feature-flow', 'other')], 'feature')).toBeNull();
  const more = [c('flows:implement', 'flows'), c('flows:fix-flow', 'flows'), c('flows:upgrade', 'flows')];
  expect(resumeCommand(more, 'implement')).toBe('flows:implement');
  expect(resumeCommand(more, 'fix')).toBe('flows:fix-flow');
  expect(resumeCommand(more, 'upgrade')).toBe('flows:upgrade');
  expect(resumeCommand(more, 'nope')).toBeNull();
});
