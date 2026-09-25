// Vendor graphify's Claude Code skill (bash variant + references/ sidecar) into plugins/graphify/skills/graphify/.
// Upstream isn't a Claude Code plugin: `graphify install` copies these files into ~/.claude/skills. The plugin's
// hooks/hooks.json is hand-written and not touched here. Idempotent: re-running against the same commit gives no diff.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT, fail, finish, git, sparseClone } from "./sync-lib.mjs";

const UPSTREAM_URL = "https://github.com/Graphify-Labs/graphify.git";
const REFERENCES = ["add-watch", "exports", "extraction-spec", "github-and-merge", "hooks", "query", "transcribe", "update"];

const PLUGIN = join(ROOT, "plugins", "graphify");
const DEST = join(PLUGIN, "skills", "graphify");

const up = sparseClone(
  UPSTREAM_URL,
  ["/graphify/skill.md", "/graphify/skills/claude/references/", "/LICENSE", "/LICENSE-MIT", "/NOTICE"],
  { noCone: true },
);
const SRC = join(up, "graphify");
if (!existsSync(join(SRC, "skill.md"))) fail("upstream graphify/skill.md not found (renamed or removed?)");
for (const r of REFERENCES) {
  if (!existsSync(join(SRC, "skills", "claude", "references", `${r}.md`))) {
    fail(`upstream graphify/skills/claude/references/${r}.md not found`);
  }
}

rmSync(join(PLUGIN, "skills"), { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(join(SRC, "skill.md"), join(DEST, "SKILL.md"));
cpSync(join(SRC, "skills", "claude", "references"), join(DEST, "references"), { recursive: true });
for (const f of ["LICENSE", "LICENSE-MIT", "NOTICE"]) cpSync(join(up, f), join(PLUGIN, f));

finish("graphify", git("-C", up, "rev-parse", "HEAD"), join(PLUGIN, "UPSTREAM"), PLUGIN);
