// Records what transcripts lack (questions, permission prompts, agents, turn ends) into one file per Claude session.
// Watch only: nothing here decides, blocks or prints. The folder rules match the app's `capture_dir` (paths.rs).
import { appendFileSync, chmodSync, lstatSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';

export const MAX_QUESTIONS = 16 * 1024;
const EVENTS = new Set([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'Notification',
  'PermissionRequest',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
]);

const str = (v) => (typeof v === 'string' && v !== '' ? v : undefined);

/** The capture folder, or null when it would need a home folder that is not set. */
export function captureDir(env, platform) {
  const win = platform === 'win32';
  const p = win ? win32 : posix;
  let base = str(env[win ? 'LOCALAPPDATA' : 'XDG_STATE_HOME']);
  if (!base) {
    const home = str(env[win ? 'USERPROFILE' : 'HOME']);
    if (!home) return null;
    base = win ? p.join(home, 'AppData', 'Local') : p.join(home, '.local', 'state');
  }
  return p.join(base, 'flow-cockpit', 'capture');
}

const size = (v) => Buffer.byteLength(JSON.stringify(v));
// Cut by characters (code points), so a UTF-8 character or surrogate pair is never split.
const cutChars = (s, n) => (s.length <= n ? s : Array.from(s).slice(0, n).join(''));

// AskUserQuestion's questions, always an array. Past 16 KiB of JSON each entry keeps only `question` and `header`
// (the options carry most of the size; `header` is cut to 64 characters), trailing entries are dropped until it fits, and the line gets
// `questions_cut: true`.
function questionsOf(input) {
  const q = input.tool_input?.questions;
  if (!Array.isArray(q)) return {};
  if (size(q) <= MAX_QUESTIONS) return { questions: q };
  const kept = q.map((e) => ({
    question: cutChars(String(e?.question ?? ''), 4096),
    header: cutChars(str(e?.header) ?? '', 64) || undefined,
  }));
  while (kept.length > 1 && size(kept) > MAX_QUESTIONS) kept.pop();
  // One entry left and still too big: halve its question until it fits.
  let n = Array.from(kept[0]?.question ?? '').length;
  while (kept.length === 1 && size(kept) > MAX_QUESTIONS && n > 0)
    kept[0].question = cutChars(kept[0].question, (n >>= 1));
  return { questions: kept, questions_cut: true };
}

/**
 * One capture line (no trailing newline) for a hook payload, or null when there is nothing to record.
 * Shape: { v: 1, ts, event, agent?, tool_use_id?, questions?, questions_cut?, permission_tool? }: only what the window
 * reads (`Line` in core/src/activity/capture.rs). The session is the file's name.
 * `questions` is always an array; `questions_cut` is true when the questions were shortened.
 */
export function toLine(input, now) {
  try {
    if (typeof input === 'string') input = JSON.parse(input);
    if (input === null || typeof input !== 'object') return null;
    const session = str(input.session_id);
    // The session id names the file: only plain names, so nothing writes outside the capture folder.
    if (!session || !/^[A-Za-z0-9_-]+$/.test(session)) return null;
    const event = input.hook_event_name;
    if (!EVENTS.has(event)) return null;
    return JSON.stringify({
      v: 1,
      ts: new Date(now).toISOString(),
      event,
      agent: str(input.agent_id),
      tool_use_id: str(input.tool_use_id),
      ...questionsOf(input),
      permission_tool: event === 'PermissionRequest' ? str(input.tool_name) : undefined,
    });
  } catch {
    return null;
  }
}

/** Deletes capture files not written for maxAgeDays. Never throws. */
export function prune(dir, now, maxAgeDays = 30) {
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      try {
        const file = join(dir, name);
        const st = lstatSync(file);
        if (st.isFile() && now - st.mtimeMs > maxAgeDays * 86400000) unlinkSync(file);
      } catch {}
    }
  } catch {}
}

export async function main({ stdin, env, platform, now }) {
  try {
    const input = JSON.parse(stdin);
    const line = toLine(input, now);
    const dir = captureDir(env, platform);
    if (line === null || dir === null) return;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Our own folder, so a looser mode left by hand or an earlier build is tightened. No effect on Windows.
    // Best effort: writing the line is the job, so a failing chmod (another owner, no modes) must not drop it.
    if (platform !== 'win32') {
      try {
        chmodSync(dir, 0o700);
      } catch {}
    }
    const p = platform === 'win32' ? win32 : posix;
    appendFileSync(p.join(dir, `${input.session_id}.jsonl`), line + '\n', { mode: 0o600 });
    if (input.hook_event_name === 'SessionStart') prune(dir, now);
  } catch {}
}
