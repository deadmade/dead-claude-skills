// Records what transcripts lack (questions, permission prompts, agents, turn ends) into one file per Claude session.
// Watch only: nothing here decides, blocks or prints. The folder rules match the app's `capture_dir` (paths.rs).
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
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

// AskUserQuestion's questions; past 16 KiB of JSON, the JSON text cut at 16 KiB (a string, no longer an array).
function questionsOf(input) {
  const q = input.tool_input?.questions;
  if (q === undefined) return undefined;
  const bytes = Buffer.from(JSON.stringify(q));
  return bytes.length <= MAX_QUESTIONS ? q : bytes.subarray(0, MAX_QUESTIONS).toString();
}

/** One capture line (no trailing newline) for a hook payload, or null when there is nothing to record. */
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
      session,
      cwd: str(input.cwd),
      event,
      agent: str(input.agent_id),
      agent_type: str(input.agent_type),
      tool_use_id: str(input.tool_use_id),
      questions: questionsOf(input),
      notification_type: str(input.notification_type),
      message: str(input.message),
      permission_tool: event === 'PermissionRequest' ? str(input.tool_name) : undefined,
      transcript: str(input.transcript_path),
      agent_transcript: str(input.agent_transcript_path),
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
        if (now - statSync(file).mtimeMs > maxAgeDays * 86400000) unlinkSync(file);
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
    const p = platform === 'win32' ? win32 : posix;
    appendFileSync(p.join(dir, `${input.session_id}.jsonl`), line + '\n', { mode: 0o600 });
    if (input.hook_event_name === 'SessionStart') prune(dir, now);
  } catch {}
}
