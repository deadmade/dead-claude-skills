// Pure helpers over cswap's `--json` output (schema v1); register.tsx does all I/O.
import type { Account, Window } from '../types'

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

// cswap prints one JSON document (list/status/switch) or one per line (auto); the last parseable one wins.
export function lastJson(stdout: string): Json | null {
  const whole = tryParse(stdout)
  if (whole) return whole
  const lines = stdout.split('\n').map(tryParse).filter((v): v is Json => v !== null)
  return lines.at(-1) ?? null
}

export function jsonLines(stdout: string): Json[] {
  return stdout.split('\n').map(tryParse).filter((v): v is Json => v !== null)
}

function tryParse(text: string): Json | null {
  try {
    const v: unknown = JSON.parse(text)
    return isObj(v) ? v : null
  } catch {
    return null
  }
}

export function errorOf(doc: Json | null): string | null {
  if (!doc) return 'cswap printed no JSON'
  const err = doc.error
  return isObj(err) && typeof err.message === 'string' ? err.message : null
}

function windowOf(v: unknown): Window | null {
  if (!isObj(v) || typeof v.pct !== 'number') return null
  return { pct: v.pct, countdown: typeof v.countdown === 'string' ? v.countdown : null }
}

export function parseAccounts(doc: Json | null): Account[] {
  const rows = doc && Array.isArray(doc.accounts) ? doc.accounts : []
  return rows.filter(isObj).map(row => {
    const usage = isObj(row.usage) ? row.usage : isObj(row.lastGoodUsage) ? row.lastGoodUsage : {}
    const email = typeof row.email === 'string' ? row.email : '?'
    return {
      number: typeof row.number === 'number' ? row.number : 0,
      label: typeof row.alias === 'string' && row.alias ? `${row.alias} (${email})` : email,
      active: row.active === true,
      disabled: row.disabled === true,
      status: typeof row.usageStatus === 'string' ? row.usageStatus : 'unavailable',
      fiveHour: windowOf(usage.fiveHour),
      sevenDay: windowOf(usage.sevenDay),
    }
  })
}

const STATUS_TEXT: Record<string, string> = {
  token_expired: 'token expired',
  relogin_required: 'log in again',
  no_credentials: 'no credentials',
  api_key: 'API key',
  unavailable: 'usage unavailable',
  foreign_credential: 'login drifted, switch to repair',
  keychain_unavailable: 'keychain unavailable',
}

export const statusText = (a: Account): string | null => (a.status === 'ok' ? null : STATUS_TEXT[a.status] ?? a.status)

const pct = (w: Window | null) => (w ? `${Math.round(w.pct)}%` : '–')

export function statusLine(accounts: readonly Account[]): string | undefined {
  const a = accounts.find(x => x.active)
  if (!a) return accounts.length ? 'cswap: no managed account active' : undefined
  const note = statusText(a)
  const usage = a.fiveHour || a.sevenDay ? `5h ${pct(a.fiveHour)} · 7d ${pct(a.sevenDay)}` : null
  return [`cswap #${a.number} ${a.label}`, usage, note].filter(Boolean).join(' · ')
}

export function bar(w: Window | null, width = 10): string {
  if (!w) return `${'·'.repeat(width)}   –`
  const filled = Math.max(0, Math.min(width, Math.round((w.pct / 100) * width)))
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${pct(w).padStart(4)}`
}

export function summary(accounts: readonly Account[]): string {
  if (!accounts.length) return 'No accounts yet: log into Claude Code, then run `cswap add` in a terminal.'
  return accounts
    .map(a => {
      const flags = [a.disabled && 'disabled', statusText(a)].filter(Boolean).join(', ')
      const reset = a.fiveHour?.countdown ? ` (resets ${a.fiveHour.countdown})` : ''
      return `${a.active ? '●' : '○'} #${a.number} ${a.label}: 5h ${pct(a.fiveHour)}${reset} · 7d ${pct(a.sevenDay)}${flags ? ` [${flags}]` : ''}`
    })
    .join('\n')
}

// `/swap` arguments → cswap argv (without the binary); null opens the pane.
export function swapArgv(args: string): string[] | null {
  const target = args.trim()
  if (!target) return null
  if (target === 'next') return ['switch', '--json']
  if (target === 'best') return ['switch', '--strategy', 'best', '--json']
  return ['switch', target, '--json']
}

export function switchedTo(doc: Json | null): string | null {
  const to = doc && isObj(doc.to) ? doc.to : null
  if (!to) return null
  return `#${String(to.number)} ${String(to.email)}`
}

// `cswap auto --once` exit codes: 0 switched, 1 error, 2 nothing to do, 3 blocked (no viable target).
export type AutoOutcome =
  | { kind: 'switched'; to: string | null }
  | { kind: 'idle' }
  | { kind: 'blocked'; detail: string }
  | { kind: 'error'; detail: string }

export function autoOutcome(exitCode: number, stdout: string): AutoOutcome {
  const events = jsonLines(stdout)
  const detail = (kind: string) => {
    const ev = events.findLast(e => e.event === kind)
    return String(ev?.detail ?? ev?.reason ?? ev?.message ?? '')
  }
  if (exitCode === 0) return { kind: 'switched', to: switchedTo(events.findLast(e => e.event === 'switch') ?? null) }
  if (exitCode === 2) return { kind: 'idle' }
  if (exitCode === 3) {
    const exhausted = events.findLast(e => e.event === 'all-exhausted')
    if (exhausted) {
      const reset = typeof exhausted.earliestResetAt === 'string' ? `, next reset ${exhausted.earliestResetAt}` : ''
      return { kind: 'blocked', detail: `all accounts exhausted${reset}` }
    }
    return { kind: 'blocked', detail: detail('no-switch') || 'no viable account' }
  }
  return { kind: 'error', detail: detail('error') || `exit ${exitCode}` }
}
