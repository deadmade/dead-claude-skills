// One-off: node agreement.mjs <result.json>...
// Per case and arm, judges each pair of the repeated replies with `claude -p` and prints the agreeing-pair counts.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const judge = (a, b) => {
  const prompt =
    "Do these two answers recommend the same approach? First line AGREE or DIFFER, second line the point of difference.\n\n" +
    `=== ANSWER 1 ===\n${a}\n\n=== ANSWER 2 ===\n${b}`;
  const r = spawnSync("claude", ["-p", prompt], { encoding: "utf8", timeout: 180000 });
  if (r.status !== 0) throw new Error(`claude -p failed: ${r.stderr}`);
  return /^\W*AGREE/i.test(r.stdout.trim());
};

// The reply text is the answers grader's evidence (focus: last_message).
const MIN_REPLY = 200; // a real answer is >1 KB; shorter means a missing or truncated evidence string
const reply = (run, where) => {
  const text = run.graders.find((g) => g.name === "answers")?.evidence ?? "";
  if (text.trim().length < MIN_REPLY) throw new Error(`reply too short or missing (${text.length} chars) at ${where}`);
  return text;
};

for (const file of process.argv.slice(2)) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  console.log(`# ${file} (cost $${json.costUsd?.toFixed(2)})`);
  for (const c of json.cases) {
    const out = { name: c.name };
    for (const arm of ["with", "without"]) {
      const replies = (c.arms[arm] ?? []).map((r, i) => reply(r, `${c.name}/${arm}/run${i + 1}`));
      let agree = 0;
      for (let i = 0; i < replies.length; i++)
        for (let j = i + 1; j < replies.length; j++) agree += judge(replies[i], replies[j]) ? 1 : 0;
      out[arm] = `${agree}/${(replies.length * (replies.length - 1)) / 2}`;
    }
    if (process.env.SHOW) for (const arm of ["with", "without"]) (c.arms[arm] ?? []).slice(0, 2).forEach((r, i) => console.log(`  [${c.name} ${arm} #${i + 1}] ${reply(r, "").slice(0, 300).replace(/\n/g, " ")}`));
    console.log(`${out.name}\twith ${out.with}\twithout ${out.without}`);
  }
}
