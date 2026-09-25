// Tests for plugins/dev-feature/hooks/dev-feature-guard.mjs: feeds hook JSON to it inside a throwaway git repo
// with a throwaway state dir. Cases run in order and share state, like a real session.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

const GUARD = join(import.meta.dirname, "..", "plugins", "dev-feature", "hooks", "dev-feature-guard.mjs");
const tmp = mkdtempSync(join(tmpdir(), "dev-feature-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const project = join(tmp, "project");
execFileSync("git", ["init", "-q", project]);
const stateDir = join(tmp, "state");
const env = { ...process.env, DEV_FEATURE_STATE_DIR: stateDir, CLAUDE_PROJECT_DIR: project };

const run = (args, input = "") => spawnSync(process.execPath, [GUARD, ...args], { input, env, cwd: project, encoding: "utf8" });
const preTool = (tool_name, tool_input) =>
  run(["pre-tool"], JSON.stringify({ hook_event_name: "PreToolUse", cwd: project, tool_name, tool_input })).stdout;
const writeTo = (file_path) => preTool("Write", { file_path, content: "x" });
const bashCmd = (command) => preTool("Bash", { command });
const prompt = (p) => run(["prompt"], JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: project, prompt: p })).stdout;

const allow = (out) => assert.equal(out, "");
const denied = (out) => assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, "deny");
const contextHas = (out, s) => assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, new RegExp(s));

const code = join(project, "src", "app.ts");
const design = join(project, "docs", "features", "checkout", "design.md");
const notes = join(project, "docs", "features", "checkout", "notes.md");

test("inactive", () => {
  allow(writeTo(code));
  allow(prompt("approve design"));
});

test("start", () => {
  assert.equal(run(["start", "checkout"]).status, 0);
  assert.notEqual(run(["start", "other"]).status, 0, "second feature refused while one is active");
  assert.notEqual(run(["start", "Bad Slug"]).status, 0, "invalid slug refused");
  assert.equal(run(["start", "checkout"]).status, 0, "re-starting the same feature is a no-op");
});

test("before approval", () => {
  denied(writeTo(code));
  denied(writeTo("src/app.ts"));
  denied(writeTo(join(project, "docs/features/../../src/app.ts")));
  denied(preTool("Edit", { file_path: code }));
  denied(preTool("NotebookEdit", { notebook_path: join(project, "n.ipynb") }));
  allow(writeTo(design));
  allow(writeTo(join(tmp, "elsewhere.txt")));
  contextHas(prompt("what next?"), "checkout");

  mkdirSync(dirname(design), { recursive: true });
  writeFileSync(design, "# Checkout\n\n## Public methods\n- createOrder(cart: Cart): Order\n");
  writeFileSync(notes, "---\nphase: understanding\nverdict: not-ready\n---\n");
  contextHas(prompt("approve design"), "refused");
  denied(writeTo(code));
});

test("bash guard", () => {
  denied(bashCmd(`rm -rf ${stateDir}`));
  denied(bashCmd("rm -rf ~/.claude/dev-feature"));
  denied(bashCmd(`echo '{}' | node ${GUARD} prompt`));
  allow(bashCmd(`node ${GUARD} status`));
  allow(bashCmd("git status"));
});

test("approval", () => {
  writeFileSync(notes, "---\nphase: design\nverdict: ready\n---\n");
  contextHas(prompt("don't approve design yet"), "checkout");
  denied(writeTo(code));
  contextHas(prompt("  Approve Design "), "approved");
  allow(writeTo(code));
  allow(writeTo(notes));
  assert.match(run(["status"]).stdout, /unlocked/);
});

test("deviation", () => {
  appendFileSync(design, "- refund(order: Order): Refund\n");
  denied(writeTo(code));
  contextHas(prompt("approve design"), "approved");
  allow(writeTo(code));
});

test("release", () => {
  contextHas(prompt("feature done"), "released");
  allow(writeTo(code));
  run(["start", "refunds"]);
  contextHas(prompt("feature abort"), "released");
  allow(writeTo(code));
});
