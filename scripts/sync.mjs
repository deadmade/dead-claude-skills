// Runs one entry of scripts/sync-sources.mjs for .github/workflows/sync.yml:
//   node scripts/sync.mjs --list [name]         the matrix: every source's name as JSON, or just `name`
//   node scripts/sync.mjs run <name>            sync, check, write the PR's title, body and paths to GITHUB_OUTPUT
//   node scripts/sync.mjs issues <name>         open an issue per new upstream skill the sync reported
//   node scripts/sync.mjs failed <name> <url>   open (or comment on) the "Sync <name> failing" issue
//   node scripts/sync.mjs passed <name> <url>   close it again
// The script's files (new skills, report, PR body) live in $RUNNER_TEMP/sync/<name>/, so later steps find them.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fail } from './sync-lib.mjs';
import { SOURCES } from './sync-sources.mjs';

export function source(name) {
  return SOURCES.find((s) => s.name === name) ?? fail(`unknown source ${name}; one of ${names().join(', ')}`);
}

export const names = (only) => (only ? [source(only).name] : SOURCES.map((s) => s.name));

// GITHUB_OUTPUT lines; a value with a newline takes the heredoc form.
export function formatOutputs(values) {
  return Object.entries(values)
    .map(([key, value]) => {
      if (!String(value).includes('\n')) return `${key}=${value}\n`;
      const eof = `EOF_${randomUUID()}`;
      return `${key}<<${eof}\n${value}\n${eof}\n`;
    })
    .join('');
}

// The key=value lines a sync script appended to its GITHUB_OUTPUT.
export function parseOutputs(text) {
  return Object.fromEntries(
    text
      .split('\n')
      .map((l) => /^([\w-]+)=(.*)$/.exec(l))
      .filter(Boolean)
      .map(([, k, v]) => [k, v]),
  );
}

export function newSkillIssue(spec, skill, desc) {
  const name = skill.split('/').at(-1);
  const body = [
    spec.lead(skill),
    '',
    `> ${desc || 'no description'}`,
    '',
    `Source: ${spec.source(skill)}`,
    '',
    `Decide in \`${spec.script}\`:`,
    `- **Include:** ${spec.include(skill)}, bump the skill count check in \`scripts/sync-sources.mjs\`, run the script.` +
      (spec.after ? ` ${spec.after}` : ''),
    `- **Skip:** add \`${skill}\` to \`SKIPPED\`.`,
    '',
    `Check for overlap with ${spec.overlap} before including it.`,
  ].join('\n');
  return { name, title: spec.title(name), body };
}

export const failingTitle = (name) => `Sync ${name} failing`;

// Whether `titles` (one per line, as `gh issue list --jq '.[].title'` prints them) holds exactly `title`.
export const hasTitle = (titles, title) => titles.split('\n').includes(title);

const workDir = (name) => join(process.env.RUNNER_TEMP || tmpdir(), 'sync', name);
const readIfExists = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();

function files(name) {
  const dir = workDir(name);
  return {
    dir,
    newSkills: join(dir, 'new-skills.tsv'),
    report: join(dir, 'report.txt'),
    scriptBody: join(dir, 'script-body.md'),
    scriptOutput: join(dir, 'script-output'),
    body: join(dir, 'body.md'),
  };
}

function run(name) {
  const src = source(name);
  const f = files(name);
  rmSync(f.dir, { recursive: true, force: true });
  mkdirSync(f.dir, { recursive: true });
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', src.script), ...(src.args ?? [])], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NEW_SKILLS_FILE: f.newSkills,
        SYNC_REPORT: f.report,
        PR_BODY_FILE: f.scriptBody,
        GITHUB_OUTPUT: f.scriptOutput,
      },
    });
  } catch {
    fail(`scripts/${src.script} failed`);
  }

  let values;
  try {
    values = src.check(parseOutputs(readIfExists(f.scriptOutput)));
  } catch (e) {
    fail(`${name}: ${e.message}`);
  }
  const body =
    src.bodyFrom === 'script'
      ? readFileSync(f.scriptBody, 'utf8')
      : src.body(values, src.bodyFrom === 'report' ? readIfExists(f.report) : undefined);
  writeFileSync(f.body, body);

  const title = src.title(values);
  const outputs = formatOutputs({
    branch: `sync/${name}`,
    title,
    'commit-message': src.commitMessage?.(values) ?? title,
    'body-path': f.body,
    paths: src.paths.join('\n'),
    scan: String(src.scan ?? true),
  });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
  else process.stdout.write(outputs);
}

function issues(name) {
  const spec = source(name).newSkills;
  const tsv = readIfExists(files(name).newSkills);
  if (!spec || !tsv.trim()) return console.log('No new upstream skills.');
  for (const line of tsv.split('\n').filter(Boolean)) {
    const [skill, desc = ''] = line.split('\t');
    const { name: short, title, body } = newSkillIssue(spec, skill, desc);
    const titles = gh(
      'issue',
      'list',
      '--state',
      'all',
      '--limit',
      '100',
      '--search',
      `${short} in:title`,
      '--json',
      'title',
      '--jq',
      '.[].title',
    );
    if (hasTitle(titles, title)) {
      console.log(`Already flagged: ${short}`);
      continue;
    }
    gh('issue', 'create', '--title', title, '--body', body);
  }
}

function openFailing(name) {
  const title = failingTitle(name);
  const found = JSON.parse(
    gh(
      'issue',
      'list',
      '--state',
      'open',
      '--limit',
      '100',
      '--search',
      `"${title}" in:title`,
      '--json',
      'number,title',
    ),
  );
  return found.find((i) => i.title === title)?.number;
}

function failed(name, url) {
  const number = openFailing(name);
  if (number) return gh('issue', 'comment', String(number), '--body', `Failed again: ${url}`);
  const body = `The weekly sync of \`${name}\` (\`.github/workflows/sync.yml\`) failed: ${url}\n\nThe next green run closes this issue.\n\ncc @deadmade`;
  gh('issue', 'create', '--title', failingTitle(name), '--body', body);
}

function passed(name, url) {
  const number = openFailing(name);
  if (number) gh('issue', 'close', String(number), '--reason', 'completed', '--comment', `Green again: ${url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, name, url] = process.argv.slice(2);
  if (cmd === '--list') console.log(JSON.stringify(names(name)));
  else if (cmd === 'run' && name) run(name);
  else if (cmd === 'issues' && name) issues(name);
  else if (cmd === 'failed' && name && url) failed(name, url);
  else if (cmd === 'passed' && name && url) passed(name, url);
  else fail('usage: node scripts/sync.mjs --list [name] | run <name> | issues <name> | failed|passed <name> <run-url>');
}
