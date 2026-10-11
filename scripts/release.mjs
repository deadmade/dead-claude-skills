// Cuts a release: one version for package.json, the marketplace, every local plugin and brv, committed and tagged
// vX.Y.Z on master. Pushing the tag runs .github/workflows/release.yml, which builds cswap.exe and brv and publishes the
// GitHub release. Claude Code only offers plugin updates when this version changes.
// Usage: npm run release -- patch|minor|major|X.Y.Z
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

process.chdir(join(import.meta.dirname, ".."));

const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const git = (...args) => {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.status !== 0) die(`git ${args.join(" ")} failed:\n${r.stderr}`);
  return r.stdout.trim();
};
const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit" }).status === 0;

const current = JSON.parse(readFileSync("package.json", "utf8")).version;
const bump = process.argv[2];
const [major, minor, patch] = current.split(".").map(Number);
const next = { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[bump] ?? bump;
if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) die("usage: npm run release -- patch|minor|major|X.Y.Z");

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "master") die(`releases are cut from master, you are on ${branch}`);
if (git("status", "--porcelain")) die("working tree is not clean");
if (git("tag", "--list", `v${next}`)) die(`tag v${next} already exists`);

// Each file's own version line, edited in place so the rest of the file keeps its formatting. JSON: the top-level
// (or marketplace metadata) "version". brv: its crate version, and its entry in Cargo.lock so --locked builds pass.
const json = /^( {2,4}"version": )"[^"]*"/m;
const bumps = [
  ["package.json", json],
  ["npm-shrinkwrap.json", json],
  // The lockfile repeats the version in its root package entry.
  ["npm-shrinkwrap.json", /^( {4}"": \{\n {6}"name": "dead-claude-skills",\n {6}"version": )"[^"]*"/m],
  [".claude-plugin/marketplace.json", json],
  ...readdirSync("plugins").map((p) => [`plugins/${p}/.claude-plugin/plugin.json`, json]),
  ["plugins/tui-review/brv/Cargo.toml", /^(version = )"[^"]*"/m],
  ["plugins/tui-review/brv/Cargo.lock", /^(name = "brv"\nversion = )"[^"]*"/m],
];
const files = bumps.map(([f]) => f);
for (const [f, version] of bumps) {
  const text = readFileSync(f, "utf8");
  if (!version.test(text)) die(`${f} has no version to bump`);
  writeFileSync(f, text.replace(version, `$1"${next}"`));
}

const tests = readdirSync("installer").filter((f) => f.endsWith(".test.mjs")).map((f) => `installer/${f}`);
if (!run("node", ["scripts/check-repo.mjs"]) || !run("node", ["--test", ...tests])) {
  git("checkout", "--", ...files);
  die("checks failed, versions reverted");
}

// Releasing the version already on master (the first release) only tags.
if (git("status", "--porcelain")) git("commit", "-m", `Release v${next}`, "--", ...files);
git("tag", "-a", `v${next}`, "-m", `v${next}`);
console.log(`\n✓ v${current} → v${next}, committed and tagged. Publish with:\n\n    git push --follow-tags origin master\n`);
