// Vendor nutlope/hallmark's skill into dead-skills and scope it to web files via its description.
// Idempotent: re-running against the same upstream commit produces no diff.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, fail, finish, git, sparseClone } from "./sync-lib.mjs";

const UPSTREAM_URL = "https://github.com/nutlope/hallmark.git";
// Prefixed to the description to keep the skill out of non-web work. Must not contain double quotes
// (it lands inside a double-quoted YAML string). `paths:` frontmatter would be the cleaner fix, but
// Claude Code ignores it for plugin skills (verified on 2.1.272; it only works for project skills).
const SCOPE =
  "WEB FRONTEND ONLY: use solely for browser UI work (HTML/CSS, React/Vue/Svelte/Astro pages and components); never for CLIs, backends, libraries, or non-web apps (e.g. Rust, Python, Go), even when asked for a new app.";

const DEST = join(ROOT, "plugins", "dead-skills", "skills", "hallmark");

// In the first frontmatter block (which must name the skill `hallmark`): prefix the description with SCOPE.
// Returns null when the frontmatter isn't shaped as expected.
function scopeDescription(text) {
  const lines = text.split("\n");
  if (lines[0] !== "---") return null;
  let named = false;
  let described = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === "---") return named && described ? lines.join("\n") : null;
    if (/^name:\s*hallmark\s*$/.test(line)) {
      named = true;
    } else if (/^description:\s*"/.test(line)) {
      lines[i] = line.replace(/^description:\s*"/, () => `description: "${SCOPE} `);
      described = true;
    } else if (/^description:\s*[^"|>\s]/.test(line)) {
      const v = line.replace(/^description:\s*/, "").replaceAll('"', '\\"');
      lines[i] = `description: "${SCOPE} ${v}"`;
      described = true;
    }
  }
  return null;
}

const up = sparseClone(UPSTREAM_URL, ["skills/hallmark"]);
const SRC = join(up, "skills", "hallmark");
if (!existsSync(join(SRC, "SKILL.md"))) fail("upstream skills/hallmark/SKILL.md not found");

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true });
cpSync(join(up, "LICENSE"), join(DEST, "LICENSE"));

const scoped = scopeDescription(readFileSync(join(DEST, "SKILL.md"), "utf8"));
if (scoped === null) fail("unexpected SKILL.md frontmatter upstream (missing --- block or 'name: hallmark')");
writeFileSync(join(DEST, "SKILL.md"), scoped);

finish("hallmark", git("-C", up, "rev-parse", "HEAD"), join(DEST, "UPSTREAM"), DEST);
