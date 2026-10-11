// Repo checks for the pre-commit hook: every plugin manifest validates, the marketplace and the dead-skills
// bundle agree on the plugin list, and everything carries package.json's version (brv's may trail it). Skips
// `claude plugin validate` when claude isn't on PATH (nix flake check sandbox, CI).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

process.chdir(join(import.meta.dirname, ".."));

const MARKETPLACE = ".claude-plugin/marketplace.json";
const BUNDLE = "plugins/dead-skills/.claude-plugin/plugin.json";
const problems = [];
const pluginDirs = readdirSync("plugins", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `plugins/${d.name}`);

// --- claude plugin validate ---
for (const target of [".", ...pluginDirs.map((d) => d + "/")]) {
  const r = spawnSync("claude", ["plugin", "validate", target], { encoding: "utf8" });
  if (r.error?.code === "ENOENT") {
    console.log("claude not on PATH: skipping claude plugin validate");
    break;
  }
  if (r.status !== 0) problems.push(`claude plugin validate ${target} failed:\n${r.stdout}${r.stderr}`);
}

// --- marketplace <-> bundle <-> plugins/ ---
const { plugins: market, allowCrossMarketplaceDependenciesOn: crossAllowed = [] } = JSON.parse(readFileSync(MARKETPLACE, "utf8"));
const deps = JSON.parse(readFileSync(BUNDLE, "utf8")).dependencies;

for (const dep of deps) {
  const [name, from] = dep.split("@");
  if (from) {
    // Anthropic's own plugins come straight from their marketplace, which must be allowlisted to auto-install.
    if (!crossAllowed.includes(from)) problems.push(`${BUNDLE}: dependency ${dep} needs ${from} in allowCrossMarketplaceDependenciesOn`);
  } else if (!market.some((p) => p.name === name)) problems.push(`${BUNDLE}: dependency ${dep} is not in ${MARKETPLACE}`);
}
for (const { source } of market) {
  if (typeof source === "string" && !existsSync(join(source, ".claude-plugin", "plugin.json"))) {
    problems.push(`${MARKETPLACE}: ${source} has no .claude-plugin/plugin.json`);
  }
}
for (const dir of pluginDirs) {
  if (!market.some((p) => p.source === `./${dir}`)) problems.push(`${dir} is not listed in ${MARKETPLACE}`);
}

// --- one version: package.json, marketplace metadata.version, every local plugin.json; brv trails (scripts/release.mjs)
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const marketVersion = JSON.parse(readFileSync(MARKETPLACE, "utf8")).metadata?.version;
if (marketVersion !== version) problems.push(`${MARKETPLACE}: metadata.version is ${marketVersion}, package.json has ${version}`);
const lock = JSON.parse(readFileSync("npm-shrinkwrap.json", "utf8"));
if (lock.version !== version || lock.packages?.[""]?.version !== version) problems.push(`npm-shrinkwrap.json: version is ${lock.version}, package.json has ${version}`);
for (const dir of pluginDirs) {
  const manifest = join(dir, ".claude-plugin", "plugin.json");
  const v = existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).version;
  if (v !== version) problems.push(`${manifest}: version is ${v}, package.json has ${version}`);
}
// brv keeps the version of the release that last changed it (scripts/release.mjs), so it may trail package.json.
const CARGO = "plugins/tui-review/brv/Cargo.toml";
const brv = /^version = "(.*)"/m.exec(readFileSync(CARGO, "utf8"))?.[1];
// Compares X.Y.Z versions: negative, zero or positive as a is older, the same or newer; NaN when either isn't X.Y.Z.
const semver = (v) => (/^\d+\.\d+\.\d+$/.test(v ?? "") ? v.split(".").map(Number) : [NaN]);
const compare = (a, b) => semver(a).reduce((d, n, i) => d || n - semver(b)[i], 0);
if (!(compare(brv, version) <= 0)) problems.push(`${CARGO}: version is ${brv}, newer than package.json's ${version} or not X.Y.Z`);
const brvLock = /^name = "brv"\nversion = "(.*)"/m.exec(readFileSync("plugins/tui-review/brv/Cargo.lock", "utf8"))?.[1];
if (brvLock !== brv) problems.push(`plugins/tui-review/brv/Cargo.lock: brv is ${brvLock}, Cargo.toml has ${brv}`);

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("✓ repo checks passed");
