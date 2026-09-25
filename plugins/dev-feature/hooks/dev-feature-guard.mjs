#!/usr/bin/env node
// dev-feature lock. Hook entry points: `pre-tool` (PreToolUse) and `prompt` (UserPromptSubmit).
// Skill entry points: `start <slug>` and `status`.
//
// While a feature is active for a repo, file edits inside the repo are denied (except docs/features/) until the
// user types exactly "approve design" and design.md still hashes to what was approved. Only the user's own prompt
// can approve or release the lock. This stops drift, not a deliberate bypass: Bash file writes aren't inspected.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = process.env.DEV_FEATURE_STATE_DIR || join(homedir(), ".claude", "dev-feature");

// fs.writeSync, not process.stdout: stdout pipes are async on Windows and process.exit would drop the output.
function exit(out, code = 0) {
  if (out) writeFileSync(code ? 2 : 1, out + "\n");
  process.exit(code);
}
const die = (msg) => exit(msg, 1);

const sha = (data) => createHash("sha256").update(data).digest("hex");

function projectRoot() {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return dir;
  }
}

const stateFile = (root) => join(STATE_DIR, sha(root).slice(0, 16) + ".json");
const readState = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeState = (file, state) => writeFileSync(file, JSON.stringify(state, null, 2) + "\n");

// Comparable path: forward slashes; on Windows lowercase and /c/... → c:/...
function norm(p) {
  p = p.replaceAll("\\", "/");
  if (process.platform === "win32" || /^[A-Za-z]:/.test(p)) {
    p = p.replace(/^\/([A-Za-z])\/(.*)$/, "$1:/$2").toLowerCase();
  }
  return p.replace(/\/$/, "");
}

function anyState() {
  try {
    return readdirSync(STATE_DIR).some((f) => f.endsWith(".json"));
  } catch {
    return false;
  }
}

function deny(reason) {
  exit(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    }),
  );
}

function context(forClaude, forUser = "") {
  const out = { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: forClaude } };
  if (forUser) out.systemMessage = forUser;
  exit(JSON.stringify(out));
}

function designSha(root, slug) {
  const design = join(root, "docs", "features", slug, "design.md");
  return existsSync(design) ? sha(readFileSync(design)) : "";
}

// Active state for this repo, or null.
function activeState() {
  if (!anyState()) return null;
  const root = projectRoot();
  const file = stateFile(root);
  if (!existsSync(file)) return null;
  return { root, file, ...readState(file) };
}

function preTool() {
  const st = activeState();
  if (!st) exit();
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const { slug, approved_sha: approved = "" } = st;

  switch (input.tool_name) {
    case "Bash": {
      const cmd = input.tool_input?.command ?? "";
      const parts = cmd.split("dev-feature-guard.mjs").slice(1);
      if (parts.some((rest) => !/^["']?\s+(start|status)(\s|$)/.test(rest))) {
        deny("dev-feature: only 'dev-feature-guard.mjs start|status' may be run. Approval and release come from the user's own prompt.");
      }
      if (cmd.includes(STATE_DIR) || cmd.includes(".claude/dev-feature") || cmd.includes("approved_sha")) {
        deny("dev-feature: the lock state belongs to the user. Don't read around or change it; ask the user.");
      }
      exit();
    }
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      break;
    default:
      exit();
  }

  let path = input.tool_input?.file_path || input.tool_input?.notebook_path || "";
  if (!path) exit();
  path = norm(path);
  if (!path.startsWith("/") && !/^[a-z]:\//.test(path)) path = norm(input.cwd || process.cwd()) + "/" + path;
  if (`/${path}/`.includes("/../")) {
    deny("dev-feature: paths with '..' are not allowed while the design is locked. Use the absolute path.");
  }

  const nroot = norm(st.root);
  const nproj = norm(process.env.CLAUDE_PROJECT_DIR || st.root);
  let rel;
  if (path.startsWith(nroot + "/")) rel = path.slice(nroot.length + 1);
  else if (path.startsWith(nproj + "/")) rel = path.slice(nproj.length + 1);
  else exit();
  if (rel.startsWith("docs/features/")) exit();

  if (!approved) {
    deny(`dev-feature '${slug}': the design is not approved, so code in this repo is locked. Only docs/features/${slug}/ may be edited. Continue the dev-feature phases; the user unlocks code by typing exactly: approve design. Don't work around this lock (no file writes through Bash).`);
  }
  if (designSha(st.root, slug) !== approved) {
    deny(`dev-feature '${slug}': design.md changed since the user approved it, so code is locked again. Record the deviation in notes.md, grill the user on the change, then ask them to type: approve design.`);
  }
  exit();
}

function frontmatterValue(file, key) {
  if (!existsSync(file)) return "";
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  if (lines[0] !== "---") return "";
  for (const line of lines.slice(1)) {
    if (line === "---") break;
    if (line.startsWith(key + ":")) return line.slice(key.length + 1).trim();
  }
  return "";
}

function promptHook() {
  const st = activeState();
  if (!st) exit();
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const text = (input.prompt ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const { root, file, slug, approved_sha: approved = "" } = st;

  if (text === "approve design") {
    const current = designSha(root, slug);
    if (!current) {
      context(`dev-feature '${slug}': approval refused, docs/features/${slug}/design.md does not exist.`,
        "dev-feature: approval refused, design.md does not exist");
    }
    const verdict = frontmatterValue(join(root, "docs", "features", slug, "notes.md"), "verdict");
    if (verdict !== "ready") {
      context(`dev-feature '${slug}': approval refused, the verdict in notes.md is '${verdict || "missing"}', not 'ready'. There is no override: the user must pass the understanding grill first.`,
        "dev-feature: approval refused, verdict is not ready");
    }
    writeState(file + ".tmp", { ...readState(file), approved_sha: current });
    renameSync(file + ".tmp", file);
    context(`dev-feature '${slug}': the user approved design.md (sha256 ${current.slice(0, 12)}). Code is unlocked. Implement against the design; any edit to design.md locks code again until the user re-approves.`,
      "dev-feature: design approved, implementation unlocked");
  }
  if (text === "feature done" || text === "feature abort") {
    const how = text.slice("feature ".length);
    rmSync(file, { force: true });
    context(`dev-feature '${slug}': the user released the lock (${how}).`, `dev-feature: '${slug}' released (${how})`);
  }

  if (!approved) {
    context(`dev-feature '${slug}' is active in this repo; code is locked (design not approved). State: docs/features/${slug}/notes.md.`);
  }
  if (designSha(root, slug) !== approved) {
    context(`dev-feature '${slug}' is active; code is locked because design.md changed since approval. State: docs/features/${slug}/notes.md.`);
  }
  context(`dev-feature '${slug}' is active; code is unlocked against the approved design. State: docs/features/${slug}/notes.md.`);
}

function start(slug = "") {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) die(`slug must be lowercase kebab-case, got '${slug}'`);
  const root = projectRoot();
  const file = stateFile(root);
  mkdirSync(STATE_DIR, { recursive: true });
  if (existsSync(file)) {
    const existing = readState(file).slug;
    if (existing === slug) exit(`dev-feature '${slug}' is already active in ${root} (resuming)`);
    die(`dev-feature '${existing}' is still active in ${root}; the user must type 'feature done' or 'feature abort' first`);
  }
  writeState(file, { root, slug, approved_sha: "" });
  exit(`dev-feature '${slug}' started in ${root}: code is locked until the user types 'approve design'`);
}

function status() {
  const root = projectRoot();
  const file = stateFile(root);
  if (!existsSync(file)) exit(`no active dev-feature in ${root}`);
  const { slug, approved_sha: approved = "" } = readState(file);
  if (!approved) exit(`dev-feature '${slug}': locked, design not approved yet`);
  if (designSha(root, slug) !== approved) exit(`dev-feature '${slug}': locked, design.md changed since approval`);
  exit(`dev-feature '${slug}': unlocked, design approved`);
}

const [mode, arg] = process.argv.slice(2);
if (mode === "pre-tool") preTool();
else if (mode === "prompt") promptHook();
else if (mode === "start") start(arg);
else if (mode === "status") status();
else die("usage: dev-feature-guard.mjs pre-tool|prompt|start <slug>|status");
