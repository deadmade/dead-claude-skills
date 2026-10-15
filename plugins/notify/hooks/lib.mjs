import { basename } from 'node:path';

// Night City lines for a finished turn and for Claude waiting on you; deliberately not night-city's own words.
export const DONE = [
  'Come look at your Agent',
  "Gig's done, choom",
  'Eddies are in your account',
  'Run complete. ICE is clean',
  'Your fixer left a message',
  "Job's wrapped. Jack back in",
  'Braindance is ready to play',
  "Delta's done. Back to you",
];
export const WAITING = [
  'Songbird requests your help',
  'Incoming call on your Agent',
  "Your fixer's on the holo",
  'Need your eyes on this, choom',
  'Netrunner awaits your authorization',
  "The daemon won't move without you",
];

const MAX = 120;

// Continuations, subagents/teammates and headless runs (-p and the SDKs report sdk-*) stay quiet.
export const shouldNotify = (input, env) =>
  !input.stop_hook_active && input.agent_id === undefined && !env.CLAUDE_CODE_ENTRYPOINT?.startsWith('sdk');

// Line 1: our pane's #{pane_active}#{window_active}; then #{client_flags} for each client on the session.
export function tmuxFocused(output) {
  const [active, ...clients] = output.split('\n');
  return active === '11' && clients.some((flags) => flags.split(',').includes('focused'));
}

export function nightCityEnabled(settingsText) {
  try {
    return JSON.parse(settingsText).enabledPlugins?.['night-city@dead-claude-skills'] === true;
  } catch {
    return false;
  }
}

// First non-empty line, cut by code points so an emoji is never split.
function firstLine(text) {
  const line = (text ?? '').split('\n').find((l) => l.trim()) ?? '';
  const chars = [...line.trim()];
  return chars.length > MAX ? chars.slice(0, MAX - 1).join('') + '…' : chars.join('');
}

export function message(input, { nightCity, pick }) {
  const done = input.hook_event_name === 'Stop';
  const status = nightCity ? pick(done ? DONE : WAITING) : done ? 'Done' : 'Needs your input';
  const detail = firstLine(
    done
      ? input.last_assistant_message
      : input.hook_event_name === 'PreToolUse'
        ? input.tool_input?.questions?.[0]?.question
        : input.message,
  );
  return {
    title: `Claude Code · ${basename(input.cwd ?? process.cwd())}`,
    body: detail ? `${status}\n${detail}` : status,
  };
}
