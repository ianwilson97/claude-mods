import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Meter, Window } from '../types'

const meter = atom({ plugin: 'usage-meter', key: 'meter' } as const, null as Meter | null)
const isHidden = atom({ plugin: 'usage-meter', key: 'footerHidden' } as const, false)
const warned = atom({ plugin: 'usage-meter', key: 'warned' } as const, [] as string[])

const HOUR = 3_600_000
const SPAN: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * 24 * HOUR }
const LABEL: Record<string, string> = { five_hour: 'session', seven_day: 'weekly', spend_limit: 'spend' }
const STEPS = [75, 90]


export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

export type Pace = { elapsedPct: number; resetsIn: number; emptyIn: number | null }

// Where the window is in time, and when it runs dry at the rate spent so far
// (null when it won't before the reset).
export function pace(w: Window, now: number): Pace | null {
  const span = SPAN[w.kind]
  if (span === undefined || w.resetsAt === undefined) return null
  const resetsIn = Date.parse(w.resetsAt) - now
  const elapsed = span - resetsIn
  if (!(elapsed > 0) || !(resetsIn >= 0)) return null
  const ratePerMs = w.percentUsed / elapsed
  const emptyIn = ratePerMs > 0 ? (100 - w.percentUsed) / ratePerMs : Infinity
  return {
    elapsedPct: Math.min(100, (100 * elapsed) / span),
    resetsIn,
    emptyIn: emptyIn < resetsIn ? emptyIn : null,
  }
}

const SHORT: Record<string, string> = { five_hour: '5h', seven_day: 'wk', spend_limit: '$' }

// The footer line: `5h ▰▰▰▱▱ 62% ↻2h · wk ▰▱▱▱▱ 18% ↻4d`, a ⚠ ETA when the pace runs dry first.
export function compact(windows: readonly Window[], now: number): string | undefined {
  if (windows.length === 0) return undefined
  return windows
    .map(w => {
      const pct = Math.round(w.percentUsed)
      const filled = Math.min(5, Math.round(pct / 20))
      const p = pace(w, now)
      const reset = p ? ` ↻${duration(p.resetsIn).split(' ')[0]}` : ''
      const eta = p?.emptyIn != null ? ` ⚠ out in ${duration(p.emptyIn)}` : ''
      return `${SHORT[w.kind] ?? w.kind} ${'▰'.repeat(filled)}${'▱'.repeat(5 - filled)} ${pct}%${reset}${eta}`
    })
    .join(' · ')
}

async function footer($: EngineInterface) {
  const m = await read($, meter)
  const isOff = await read($, isHidden)
  $.ui.status(m && !isOff ? compact(m.windows, await $.clock.now()) : undefined)
}

async function capture($: EngineInterface, windows: readonly Window[], costUsd: number | null) {
  const now = await $.clock.now()
  await update($, meter, () => ({ windows: [...windows], costUsd, measuredAt: now }))
  await footer($)
  const seen = await read($, warned)
  for (const w of windows) {
    const step = [...STEPS].reverse().find(s => w.percentUsed >= s)
    const key = `${w.kind}:${step}:${w.resetsAt ?? ''}`
    if (step !== undefined && !seen.includes(key)) {
      $.ui.toast(`${LABEL[w.kind] ?? w.kind} limit at ${Math.round(w.percentUsed)}%`)
      await update($, warned, list => [...list, key])
    }
  }
}

async function seed($: EngineInterface) {
  const usage = await $.session.usage().catch(() => null)
  if (usage) await capture($, usage.rateLimits, usage.cost?.usd ?? null)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage-meter', description: 'Show or hide the usage line under the prompt' })
    await seed($)
    // ponytail: minute tick only refreshes countdowns; figures arrive via session.measure
    $.clock.every(60_000, () => footer($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await capture($, e.rateLimits, e.cost?.usd ?? null)
    return next(e)
  })

  on('command.run', { command: 'usage-meter' }, async $ => {
    await update($, isHidden, h => !h)
    await footer($)
    return { text: (await read($, isHidden)) ? 'Usage line hidden.' : 'Usage line shown.' }
  })
}
