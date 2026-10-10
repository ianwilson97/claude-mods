import { expect, test } from 'claude-code/testing'

import type { Track } from '../types'
import { applyTask, barOf, bounceX, cellsOf, frame, fromTranscript, isMoving, summary, TONE } from './progress'

const track = (over: Partial<Track>): Track => ({
  id: 'w:cw-x', kind: 'worker', name: 'cw-x', model: 'openai/gpt-5', mode: 'acceptEdits', items: [], steps: 0,
  startedAt: 0, updatedAt: 0, endedAt: null, outcome: null, isBusy: true, from: 0, changedAt: 0, ...over,
})
const glyphs = (words: number[]) => words.filter((_, i) => i % 3 === 0).map(c => String.fromCodePoint(c)).join('')
const colors = (words: number[]) => words.filter((_, i) => i % 3 === 1)

test('TodoWrite replaces the list; the in-progress step is its activeForm', () => {
  const items = applyTask([], 'TodoWrite', {
    todos: [
      { content: 'Write parser', activeForm: 'Writing parser', status: 'completed' },
      { content: 'Test it', activeForm: 'Testing it', status: 'in_progress' },
      { content: 'Ship', activeForm: 'Shipping', status: 'pending' },
    ],
  }, null)!
  expect(summary(items)).toEqual({ done: 1, total: 3, current: 'Testing it' })
})

test('TaskCreate takes its id from the result; TaskUpdate moves and deletes; a done list restarts', () => {
  let items = applyTask([], 'TaskCreate', { subject: 'A', description: '' }, { task: { id: '1', subject: 'A' } })!
  items = applyTask(items, 'TaskCreate', { subject: 'B', description: '', activeForm: 'Doing B' }, { task: { id: '2', subject: 'B' } })!
  items = applyTask(items, 'TaskUpdate', { taskId: '1', status: 'completed' }, null)!
  items = applyTask(items, 'TaskUpdate', { taskId: '2', status: 'in_progress' }, null)!
  expect(summary(items)).toEqual({ done: 1, total: 2, current: 'Doing B' })
  expect(applyTask(items, 'TaskUpdate', { taskId: '99', status: 'completed' }, null)).toBe(null)
  expect(applyTask(items, 'TaskCreate', { subject: 'C' }, { error: 'x' })).toBe(null)
  items = applyTask(items, 'TaskUpdate', { taskId: '2', status: 'completed' }, null)!
  // every task done: the next TaskCreate starts a new list
  items = applyTask(items, 'TaskCreate', { subject: 'Next', description: '' }, { task: { id: '3', subject: 'Next' } })!
  expect(summary(items).total).toBe(1)
  expect(summary(applyTask(items, 'TaskUpdate', { taskId: '3', status: 'deleted' }, null)!).total).toBe(0)
})

// The real shape: tool_use on assistant rows, toolUseResult on the user row answering it.
const FIXTURE = [
  '{"partial line cut by tail',
  JSON.stringify({ type: 'assistant', timestamp: '2026-10-10T10:00:00.000Z', message: { content: [{ type: 'tool_use', id: 'u1', name: 'TaskCreate', input: { subject: 'Read code', description: '' } }] } }),
  JSON.stringify({ type: 'user', timestamp: '2026-10-10T10:00:01.000Z', toolUseResult: { task: { id: '1', subject: 'Read code' } }, message: { content: [{ type: 'tool_result', tool_use_id: 'u1' }] } }),
  JSON.stringify({ type: 'assistant', timestamp: '2026-10-10T10:00:02.000Z', message: { content: [{ type: 'tool_use', id: 'u2', name: 'TaskCreate', input: { subject: 'Fix bug', description: '', activeForm: 'Fixing bug' } }] } }),
  JSON.stringify({ type: 'user', timestamp: '2026-10-10T10:00:03.000Z', toolUseResult: { task: { id: '2', subject: 'Fix bug' } }, message: { content: [{ type: 'tool_result', tool_use_id: 'u2' }] } }),
  JSON.stringify({ type: 'assistant', timestamp: '2026-10-10T10:00:04.000Z', message: { content: [{ type: 'tool_use', id: 'u3', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }, { type: 'tool_use', id: 'u4', name: 'TaskUpdate', input: { taskId: '2', status: 'in_progress' } }, { type: 'tool_use', id: 'u5', name: 'Read', input: { file_path: '/x' } }] } }),
  JSON.stringify({ type: 'user', timestamp: '2026-10-10T10:00:05.000Z', toolUseResult: { success: true }, message: { content: [{ type: 'tool_result', tool_use_id: 'u3' }, { type: 'tool_result', tool_use_id: 'u4' }] } }),
].join('\n')

test('a worker transcript gives its list, its step count and its last sign of life', () => {
  const r = fromTranscript(FIXTURE)
  expect(summary(r.items)).toEqual({ done: 1, total: 2, current: 'Fixing bug' })
  expect(r.steps).toBe(5)
  expect(r.lastAt).toBe(Date.parse('2026-10-10T10:00:05.000Z'))
})

test('no list → indeterminate (no percentage), labelled by steps', () => {
  const bar = barOf(track({ steps: 4, updatedAt: 0 }), 1000, true)
  expect(bar.to).toBe(null)
  expect(bar.isLive).toBe(true)
  // the bouncing segment: three filled cells, never a % fill
  expect(glyphs(frame(bar, 0, 10))).toBe('███       ')
})

test('stalled after 3 minutes: yellow and still; finished: full and green', () => {
  const items = [{ id: '1', title: 'a', active: 'a', status: 'pending' as const }]
  const stalled = barOf(track({ items, updatedAt: 0 }), 3 * 60_000 + 1, true)
  expect(stalled.tone).toBe('yellow')
  expect(isMoving(stalled, 3 * 60_000 + 1)).toBe(false)
  const done = barOf(track({ items, endedAt: 5, outcome: 'done', isBusy: false }), 10, true)
  expect([done.tone, done.to]).toEqual(['green', 1])
  expect(barOf(track({ items, endedAt: 5, outcome: 'failed' }), 10, true).tone).toBe('red')
})

test('frame slides from the old fill to the new one in eighth-blocks', () => {
  const bar = { from: 0, to: 0.5, changedAt: 1000, tone: 'blue' as const, isLive: false, isMotionOn: true }
  expect(glyphs(frame(bar, 1000, 20))).toBe(' '.repeat(20)) // t=0
  // t=300ms: ease 0.875 → fill 0.4375 → 8.75 cells → 8 full + ▊ (6/8)
  expect(glyphs(frame(bar, 1300, 20))).toBe(`${'█'.repeat(8)}▊${' '.repeat(11)}`)
  // just after the slide: the new segment flashes green
  expect(colors(frame(bar, 1700, 20))[5]).toBe(TONE.green)
  const end = frame(bar, 3000, 20)
  expect(glyphs(end)).toBe(`${'█'.repeat(10)}${' '.repeat(10)}`)
  expect(colors(end)[5]).toBe(TONE.blue)
  expect(isMoving(bar, 3000)).toBe(false)
  // motion off: straight to the end state
  expect(glyphs(frame({ ...bar, isMotionOn: false }, 1000, 20))).toBe(glyphs(end))
})

test('eighth-block rounding: 37% of 20 cells is 7 full + ▍', () => {
  expect(cellsOf(0.37, 20)).toEqual({ full: 7, eighth: 3 })
  expect(cellsOf(0.999, 20)).toEqual({ full: 20, eighth: 0 })
})

test('the bounce runs 0 → width-3 → 0 and wraps', () => {
  expect([0, 350, 400, 700, 750].map(t => bounceX(t, 10))).toEqual([0, 7, 6, 0, 1])
})
