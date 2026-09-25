// Vendor a curated subset of mattpocock/skills into plugins/mattpocock-picks/skills/<name>/.
// A strict:false marketplace entry can't narrow it: upstream's plugin.json already lists skills,
// and Claude Code refuses to load a plugin whose manifest and marketplace entry both specify components.
// Idempotent: re-running against the same upstream commit produces no diff.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { ROOT, description, fail, finish, git, reportNew, sparseClone } from "./sync-lib.mjs";

const UPSTREAM_URL = "https://github.com/mattpocock/skills.git";
const SKILLS = [
  "engineering/grill-with-docs",
  "engineering/to-spec",
  "engineering/to-tickets",
  "engineering/improve-codebase-architecture",
  "engineering/setup-matt-pocock-skills",
  "engineering/domain-modeling",
  "engineering/codebase-design",
  "productivity/grill-me",
  "productivity/grilling",
  "productivity/handoff",
  "productivity/teach",
  "productivity/to-questionnaire",
  "productivity/wait-what",
  "productivity/writing-for-agents",
];
// Upstream skills deliberately not vendored (overlap with superpowers or not wanted yet).
// Anything upstream lists that is in neither array is reported as new (see NEW_SKILLS_FILE).
const SKIPPED = [
  "engineering/ask-matt",
  "engineering/code-review",
  "engineering/diagnosing-bugs",
  "engineering/implement",
  "engineering/prototype",
  "engineering/research",
  "engineering/resolving-merge-conflicts",
  "engineering/tdd",
  "engineering/triage",
  "engineering/wayfinder",
  "engineering/wizard",
];

const PLUGIN = join(ROOT, "plugins", "mattpocock-picks");
const DEST = join(PLUGIN, "skills");

const up = sparseClone(UPSTREAM_URL, [".claude-plugin", ...SKILLS.map((s) => `skills/${s}`)]);
for (const s of SKILLS) {
  if (!existsSync(join(up, "skills", s, "SKILL.md"))) fail(`upstream skills/${s}/SKILL.md not found (renamed or removed?)`);
}

// Skills upstream publishes (its plugin.json list) that are neither vendored nor skipped.
const known = new Set([...SKILLS, ...SKIPPED]);
const listed = readFileSync(join(up, ".claude-plugin", "plugin.json"), "utf8").match(/"\.\/skills\/[^"]+"/g) ?? [];
const NEW = listed.map((p) => p.slice('"./skills/'.length, -1)).filter((s) => !known.has(s));
if (NEW.length) {
  git("-C", up, "sparse-checkout", "add", ...NEW.map((s) => `skills/${s}`));
  reportNew(NEW.map((s) => [s, description(join(up, "skills", s, "SKILL.md"))]));
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
for (const s of SKILLS) cpSync(join(up, "skills", s), join(DEST, basename(s)), { recursive: true });
cpSync(join(up, "LICENSE"), join(PLUGIN, "LICENSE"));

finish("mattpocock-picks", git("-C", up, "rev-parse", "HEAD"), join(PLUGIN, "UPSTREAM"), PLUGIN);
