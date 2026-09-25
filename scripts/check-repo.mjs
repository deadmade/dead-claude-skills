// Repo checks for the pre-commit hook: every plugin manifest validates, and the marketplace and the dead-skills
// bundle agree on the plugin list. Skips `claude plugin validate` when claude isn't on PATH
// (nix flake check sandbox, CI).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

process.chdir(join(import.meta.dirname, ".."));

const MARKETPLACE = ".claude-plugin/marketplace.json";
const BUNDLE = "plugins/dead-skills/.claude-plugin/plugin.json";
const problems = [];
const pluginDirs = readdirSync("plugins", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `plugins/${d.name}`);

// --- claude plugin validate (warnings such as a missing version are fine) ---
for (const target of [".", ...pluginDirs.map((d) => d + "/")]) {
  const r = spawnSync("claude", ["plugin", "validate", target], { encoding: "utf8" });
  if (r.error?.code === "ENOENT") {
    console.log("claude not on PATH: skipping claude plugin validate");
    break;
  }
  if (r.status !== 0) problems.push(`claude plugin validate ${target} failed:\n${r.stdout}${r.stderr}`);
}

// --- marketplace <-> bundle <-> plugins/ ---
const market = JSON.parse(readFileSync(MARKETPLACE, "utf8")).plugins;
const deps = JSON.parse(readFileSync(BUNDLE, "utf8")).dependencies;

for (const dep of deps) {
  if (!market.some((p) => p.name === dep)) problems.push(`${BUNDLE}: dependency ${dep} is not in ${MARKETPLACE}`);
}
for (const { source } of market) {
  if (typeof source === "string" && !existsSync(join(source, ".claude-plugin", "plugin.json"))) {
    problems.push(`${MARKETPLACE}: ${source} has no .claude-plugin/plugin.json`);
  }
}
for (const dir of pluginDirs) {
  if (!market.some((p) => p.source === `./${dir}`)) problems.push(`${dir} is not listed in ${MARKETPLACE}`);
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("✓ repo checks passed");
