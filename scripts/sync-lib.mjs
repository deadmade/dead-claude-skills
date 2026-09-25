// Shared plumbing for scripts/sync-*.mjs: sparse-clone an upstream repo, report new upstream skills,
// and record the synced commit.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export const ROOT = join(import.meta.dirname, "..");

export const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

export function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Shallow, blobless, sparse clone of `url` into a temp dir, checked out to `patterns`. Returns the clone dir.
export function sparseClone(url, patterns, { noCone = false } = {}) {
  const dir = join(tempDir(), "up");
  git("clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", url, dir);
  git("-C", dir, "sparse-checkout", "set", ...(noCone ? ["--no-cone"] : []), ...patterns);
  return dir;
}

// `description:` from a SKILL.md frontmatter, unquoted; "" when missing.
export function description(skillMd) {
  if (!existsSync(skillMd)) return "";
  const line = readFileSync(skillMd, "utf8").split("\n").find((l) => l.startsWith("description:")) ?? "";
  return line.replace(/^description:\s*/, "").replace(/^"|"$/g, "");
}

// Upstream skills that are neither vendored nor skipped. With NEW_SKILLS_FILE set (the workflows), each is
// appended as "<name>\t<description>" so the workflow can open an issue for it.
export function reportNew(entries) {
  for (const [name, desc] of entries) {
    console.log(`new upstream skill (not in SKILLS or SKIPPED): ${name}: ${desc}`);
    if (process.env.NEW_SKILLS_FILE) appendFileSync(process.env.NEW_SKILLS_FILE, `${name}\t${desc}\n`);
  }
}

// Record the upstream commit, but only when something under `dir` besides `upstreamFile` changed; otherwise restore
// `upstreamFile` so an upstream move that touches nothing we vendor gives no diff (and no sync PR).
export function finish(label, sha, upstreamFile, dir) {
  const rel = relative(ROOT, upstreamFile);
  const changed = git("-C", ROOT, "status", "--porcelain", "--", dir, `:(exclude)${rel}`) !== "";
  if (changed) writeFileSync(upstreamFile, sha + "\n");
  else git("-C", ROOT, "checkout", "--", rel);
  console.log(changed ? `${label} synced to ${sha} (changed)` : `${label} unchanged at ${sha} (no vendored changes)`);
}
