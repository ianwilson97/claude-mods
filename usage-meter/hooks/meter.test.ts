import { test, expect } from 'claude-code/testing'

import { compact, duration, pace } from './register'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-07T12:00:00Z')

test('durations read naturally', () => {
  expect([duration(5 * 60_000), duration(134 * 60_000), duration(50 * HOUR)]).toEqual(['5m', '2h 14m', '2d 2h'])
})

test('forecasts running out before the reset', () => {
  // 1h into a 5h window, 40% used: 2.5h of budget at this rate, 4h until reset
  const p = pace({ kind: 'five_hour', percentUsed: 40, resetsAt: new Date(NOW + 4 * HOUR).toISOString() }, NOW)
  expect(p?.elapsedPct).toBe(20)
  expect(Math.round((p?.emptyIn ?? 0) / 60_000)).toBe(90)
})

test('no forecast when on pace', () => {
  const p = pace({ kind: 'seven_day', percentUsed: 30, resetsAt: new Date(NOW + 84 * HOUR).toISOString() }, NOW)
  expect(p?.emptyIn).toBeNull()
})

test('unknown window kinds have no pace', () => {
  expect(pace({ kind: 'spend_limit', percentUsed: 50 }, NOW)).toBeNull()
})

test('compact footer line', () => {
  const line = compact(
    [
      { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(NOW + 2 * HOUR).toISOString() },
      { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(NOW + 100 * HOUR).toISOString() },
    ],
    NOW,
  )
  // 62% after 3h of 5h runs dry in ~1h50m, before the 2h reset
  expect(line).toBe('5h ▰▰▰▱▱ 62% ↻2h ⚠ out in 1h 50m · wk ▰▱▱▱▱ 18% ↻4d')
  expect(compact([], NOW)).toBeUndefined()
})
