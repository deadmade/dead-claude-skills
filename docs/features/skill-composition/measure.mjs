// Throwaway, rough baseline for the skill-composition flow. Usage: node measure.mjs [--since D] [--until D]
// Hidden test options: --projects <dir>, --flows <dir>.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const here = dirname(fileURLToPath(import.meta.url));
const since = opt('--since', '0000');
const until = opt('--until', '9999');
const projects = opt('--projects', join(homedir(), '.claude/projects'));
const flowsDir = opt('--flows', join(here, '../../../plugins/flows/skills'));
const EXCLUDED = 'skill-composition';
const EDITISH = /\bsed\s+-i|\bperl\s+-i|\btee\b|\bgit\s+apply\b|(^|[^>\d&])>>?\s*[\w./~$"']/;

const rel = (p) =>
  String(p ?? '')
    .replace(/^.*?\.claude\/worktrees\/[^/]+\//, '')
    .replace(/^\/home\/[^/]+\/dead-claude-skills\//, '');
const flowSlug = (p) => rel(p).match(/^docs\/features\/([^/]+)\/flow\.md$/)?.[1];

function jsonlFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonlFiles(p));
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

// One session = a main .jsonl plus its <session>/subagents/**.
function sessions() {
  const out = [];
  for (const proj of readdirSync(projects)) {
    if (!proj.startsWith('-home-deadmade-dead-claude-skills') && projects === join(homedir(), '.claude/projects'))
      continue;
    const dir = join(projects, proj);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      const id = f.slice(0, -6);
      const files = [join(dir, f)];
      if (existsSync(join(dir, id))) files.push(...jsonlFiles(join(dir, id)));
      const events = files.flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((l) => {
            try {
              return [JSON.parse(l)];
            } catch {
              return [];
            }
          }),
      );
      out.push(events.filter((e) => e.timestamp));
    }
  }
  return out;
}

const blocks = (e) => (Array.isArray(e.message?.content) ? e.message.content : []);
const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b.text ?? '').join('\n') : '');

const runs = new Map(); // slug -> events[] of its sessions, plus session count
for (const ev of sessions()) {
  const day = ev[0]?.timestamp.slice(0, 10);
  if (!day || day < since || day > until) continue;
  const slugs = new Set(
    ev.flatMap((e) =>
      blocks(e)
        .filter((b) => b.type === 'tool_use')
        .map((b) => flowSlug(b.input?.file_path))
        .filter(Boolean),
    ),
  );
  for (const s of slugs) {
    if (s === EXCLUDED) continue;
    const r = runs.get(s) ?? { events: [], sessions: 0 };
    r.events.push(...ev);
    r.sessions++;
    runs.set(s, r);
  }
}

const rows = [];
for (const [slug, { events, sessions: n }] of runs) {
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const own = `docs/features/${slug}/`;
  const planPath = `${own}plan.md`;
  const readIds = new Map();
  let planText = '',
    gate = false,
    asked = false,
    conductor = '-';
  const edited = new Set(),
    loaded = new Set();
  let bashEdits = 0;
  const skills = new Set();
  const reads = new Set();
  const asConductor = (name) => {
    if (conductor === '-' && existsSync(join(flowsDir, name, 'uses.json'))) conductor = name;
  };
  for (const e of events) {
    // A slash command lands in the transcript as <command-name>/plugin:name</command-name>.
    const m = text(e.message?.content).match(/<command-name>\/?(?:[\w-]+:)?([\w-]+)/);
    if (m) asConductor(m[1]);
    for (const b of blocks(e)) {
      if (b.type === 'tool_result' && readIds.has(b.tool_use_id)) planText = text(b.content);
      if (b.type !== 'tool_use') continue;
      const i = b.input ?? {},
        f = rel(i.file_path);
      if (b.name === 'Skill') {
        const name = String(i.skill).split(':').pop();
        skills.add(name);
        asConductor(name);
      }
      if (b.name === 'Read') {
        reads.add(String(i.file_path));
        const c = String(i.file_path).match(/\/([\w-]+)\/SKILL\.md$/);
        if (c) asConductor(c[1]);
        if (f === planPath) readIds.set(b.id, 1);
      }
      if (b.name === 'AskUserQuestion' && gate) asked = true;
      if (b.name === 'Bash' && gate && EDITISH.test(i.command ?? '')) bashEdits++;
      if (b.name === 'Edit' || b.name === 'Write') {
        const dated =
          flowSlug(i.file_path) === slug && /Gate 2, plan approved: 20/.test(i.new_string ?? i.content ?? '');
        if (b.name === 'Write' && f === planPath) planText = i.content ?? '';
        if (!gate && (dated || (!f.startsWith(own) && !runHasDatedGate(events, slug)))) {
          gate = true;
          if (dated) continue;
        }
        if (gate && !f.startsWith(own) && !asked && !planText.includes(f)) edited.add(f);
      }
    }
  }
  let m2 = '-',
    missing = '-';
  const uses = conductor === '-' ? null : JSON.parse(readFileSync(join(flowsDir, conductor, 'uses.json'), 'utf8'));
  if (uses) {
    const all = Object.values(uses).flat();
    const has = (s) => skills.has(s) || [...reads].some((p) => p.endsWith(`/${s}/SKILL.md`));
    const miss = all.filter((s) => !has(s));
    m2 = `${all.length - miss.length}/${all.length}`;
    missing = miss.join(', ') || '-';
  }
  rows.push([slug, conductor, n, `${edited.size} (bash edits: ${bashEdits})`, m2, missing]);
}

function runHasDatedGate(events, slug) {
  return events.some((e) =>
    blocks(e).some(
      (b) =>
        b.type === 'tool_use' &&
        (b.name === 'Edit' || b.name === 'Write') &&
        flowSlug(b.input?.file_path) === slug &&
        /Gate 2, plan approved: 20/.test(b.input.new_string ?? b.input.content ?? ''),
    ),
  );
}

console.log(`Limits:
- m1 can't see Bash edits; the count of Bash commands that look like edits is printed next to it.
- An early question excuses every later edit.
- It compares against the whole plan text, not each task's Files list.
- It doesn't count new public interfaces.
- m2 uses today's uses.json and ignores order and optional skills.
- Runs before 2026-10-17 had no uses.json.
- Sessions that only read a flow.md are joined into its run.
- A session that touches two flow.md files counts toward both runs.
`);
const head = ['slug', 'conductor', 'sessions', 'm1', 'm2 loaded/listed', 'missing'];
const table = [head, head.map(() => '---'), ...rows.sort((a, b) => a[0].localeCompare(b[0]))];
for (const r of table) console.log(`| ${r.join(' | ')} |`);
