import { expect, test } from 'claude-code/testing';

import { gateDate, parseFlow } from './flow';

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
  expect(parseFlow(text)).toMatchObject({ phase: 'plan', research: true, gates: ['2026-10-13', null] });
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
