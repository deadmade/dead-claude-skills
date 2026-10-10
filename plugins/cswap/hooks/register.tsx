// claude-swap front end: runs the cswap binary and reads its --json output. All account logic stays in cswap.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { View } from '../types'
import { autoOutcome, bar, errorOf, lastJson, parseAccounts, statusLine, statusText, summary, swapArgv, switchedTo } from './cswap'

const PANE = 'cswap'
const TICK_MS = 120_000
const INSTALL_HINT =
  'cswap not found. Windows: rerun `npx github:deadmade/dead-claude-skills` with cswap ticked. ' +
  'Linux: `uv tool install claude-swap`. Or set the path with /plugin configure cswap.'

const view = atom({ plugin: 'cswap', key: 'view' } as const, { accounts: [], error: null, missing: false, updatedAt: 0 })

type $ = EngineInterface
type Run = { exitCode: number; stdout: string } | { exitCode: -1; stdout: ''; failed: string }

// Module state: a reload starts it over, which is fine (it's a cache and two flags).
let autoSwitch = false
let configured = ''
let bin: string | null = null
let busy = false
let blocked = false

async function candidates($: $): Promise<string[]> {
  if (configured) return [configured]
  const local = await $.env.get('LOCALAPPDATA')
  return local ? ['cswap', `${local}\\Programs\\cswap\\cswap.exe`] : ['cswap']
}

// First candidate that answers --version; re-probed while missing, so an install mid-session is picked up.
async function resolve($: $): Promise<string | null> {
  if (bin) return bin
  for (const c of await candidates($)) {
    try {
      if ((await $.process.run([c, '--version'], { timeoutMs: 15_000 })).exitCode === 0) return (bin = c)
    } catch {
      // not startable: try the next one
    }
  }
  return null
}

async function cswap($: $, args: string[], timeoutMs = 60_000): Promise<Run> {
  const exe = await resolve($)
  if (!exe) return { exitCode: -1, stdout: '', failed: INSTALL_HINT }
  try {
    const r = await $.process.run([exe, ...args], { timeoutMs })
    return { exitCode: r.exitCode, stdout: r.stdout }
  } catch (err) {
    bin = null
    return { exitCode: -1, stdout: '', failed: `cswap ${args[0]} failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function refresh($: $): Promise<View> {
  const r = await cswap($, ['list', '--json'])
  const doc = 'failed' in r ? null : lastJson(r.stdout)
  const next: View = {
    accounts: parseAccounts(doc),
    error: 'failed' in r ? r.failed : r.exitCode === 0 ? null : errorOf(doc) ?? `cswap list exited ${r.exitCode}`,
    missing: !bin,
    updatedAt: await $.clock.now(),
  }
  await update($, view, () => next)
  $.ui.status(next.missing ? undefined : statusLine(next.accounts))
  return next
}

async function autoTick($: $) {
  const r = await cswap($, ['auto', '--once', '--json'])
  if ('failed' in r) return
  const out = autoOutcome(r.exitCode, r.stdout)
  if (out.kind === 'switched') $.ui.toast(`cswap switched to ${out.to ?? 'another account'}`)
  if (out.kind === 'blocked' && !blocked) $.ui.toast(`cswap can't switch: ${out.detail}`)
  blocked = out.kind === 'blocked'
}

async function tick($: $) {
  if (busy) return
  busy = true
  try {
    if (autoSwitch) await autoTick($)
    await refresh($)
  } finally {
    busy = false
  }
}

async function swap($: $, args: string[]): Promise<string> {
  const r = await cswap($, args, 30_000)
  if ('failed' in r) return r.failed
  const doc = lastJson(r.stdout)
  const err = r.exitCode === 0 ? null : errorOf(doc) ?? `cswap exited ${r.exitCode}`
  await refresh($)
  return err ? `cswap: ${err}` : `Switched to ${switchedTo(doc) ?? 'the next account'}.`
}

function pressSwitch($: $, n: number) {
  void swap($, ['switch', String(n), '--json']).then(text => $.ui.toast(text))
}

export const register: Register = (on, options) => {
  autoSwitch = options.auto_switch === true
  configured = typeof options.cswap_path === 'string' ? options.cswap_path.trim() : ''
  bin = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'swap',
      description: 'claude-swap: open the accounts pane, or switch (next, best, a number, email or alias)',
      argumentHint: '[next|best|<num|email|alias>]',
    })
    $.clock.every(TICK_MS, () => void tick($).catch(() => {}))
    void tick($).catch(() => {})

    return next(e)
  })

  on('command.run', { command: 'swap' }, async ($, e) => {
    const argv = swapArgv(e.args)
    if (argv) return { text: await swap($, argv) }
    const placed = await $.ui.open({ id: PANE, title: 'Accounts' })
    const now = await refresh($)
    if (now.missing || now.error) return { text: now.error ?? INSTALL_HINT }
    return { text: placed.isPlaced ? 'Accounts pane opened.' : summary(now.accounts) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const v = await read($, view)

    return (
      <Box flexDirection="column">
        {v.missing && <Text color="yellow">{INSTALL_HINT}</Text>}
        {!v.missing && v.error && <Text color="red">{v.error}</Text>}
        {!v.missing && !v.error && v.accounts.length === 0 && <Text dimColor>{summary([])}</Text>}
        {v.accounts.map(a => (
          <Box key={`acc-${a.number}`} flexDirection="column" marginBottom={1}>
            <Box gap={1}>
              <Text bold={a.active}>
                {a.active ? '●' : '○'} #{a.number} {a.label}
              </Text>
              {a.disabled && <Text dimColor>(disabled)</Text>}
              {statusText(a) && <Text color="yellow">{statusText(a)}</Text>}
            </Box>
            <Text dimColor={!a.active}>
              {'  5h '}
              {bar(a.fiveHour)}
              {a.fiveHour?.countdown ? `  resets ${a.fiveHour.countdown}` : ''}
            </Text>
            <Text dimColor={!a.active}>
              {'  7d '}
              {bar(a.sevenDay)}
              {a.sevenDay?.countdown ? `  resets ${a.sevenDay.countdown}` : ''}
            </Text>
            {!a.active && <Button key={`switch-${a.number}`} label={`Switch to #${a.number}`} onPress={() => pressSwitch($, a.number)} />}
          </Box>
        ))}
        <Box gap={1}>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => void refresh($)} />
          <Text dimColor>{autoSwitch ? 'auto-switch on' : 'auto-switch off (/plugin configure cswap)'}</Text>
        </Box>
      </Box>
    )
  })
}
