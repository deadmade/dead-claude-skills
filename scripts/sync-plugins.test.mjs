import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newestTag, pin } from "./sync-plugins.mjs";

const sha = (c) => c.repeat(40);
const lsRemote = (rows) => rows.map(([s, ref]) => `${s}\t${ref}`).join("\n");

test("newestTag picks the peeled commit of an annotated tag", () => {
  const out = lsRemote([
    [sha("a"), "refs/tags/v6.4.2"],
    [sha("7"), "refs/tags/v7.0.0"],
    [sha("b"), "refs/tags/v7.0.0^{}"],
    [sha("c"), "refs/tags/v8.0.0-beta.1"],
  ]);
  assert.deepEqual(newestTag(out), { tag: "v7.0.0", sha: sha("b") });
});

test("newestTag takes the plain line of a lightweight tag and orders v5.10.0 above v5.9.0", () => {
  const out = lsRemote([
    [sha("1"), "refs/tags/v5.10.0"],
    [sha("2"), "refs/tags/v5.9.0"],
  ]);
  assert.deepEqual(newestTag(out), { tag: "v5.10.0", sha: sha("1") });
});

test("newestTag returns undefined without a stable tag", () => {
  assert.equal(newestTag(lsRemote([[sha("c"), "refs/tags/v8.0.0-rc.1"]])), undefined);
  assert.equal(newestTag(""), undefined);
});

const marketplace = readFileSync(new URL("../.claude-plugin/marketplace.json", import.meta.url), "utf8");

test("pin rewrites only the matching entry", () => {
  const current = JSON.parse(marketplace).plugins.find((p) => p.name === "ponytail").source.ref;
  const res = pin(marketplace, "DietrichGebert/ponytail", "v999.0.0", sha("f"));
  assert.equal(res.old, current);
  const before = marketplace.split(/\r?\n/); // Windows CI checks out CRLF
  const changed = res.text.split(/\r?\n/).filter((line, i) => line !== before[i]);
  assert.deepEqual(changed, [`        "ref": "v999.0.0",`, `        "sha": "${sha("f")}"`]);
});

test("pin works on a CRLF checkout (Windows CI)", () => {
  const crlf = marketplace.replace(/\r?\n/g, "\r\n");
  const res = pin(crlf, "DietrichGebert/ponytail", "v999.0.0", sha("f"));
  const before = crlf.split("\r\n");
  const changed = res.text.split("\r\n").filter((line, i) => line !== before[i]);
  assert.deepEqual(changed, [`        "ref": "v999.0.0",`, `        "sha": "${sha("f")}"`]);
});

test("pin returns undefined for an unknown repo", () => {
  assert.equal(pin(marketplace, "nobody/nothing", "v1.0.0", sha("f")), undefined);
});
