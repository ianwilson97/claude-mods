import { expect, test } from 'claude-code/testing'

import type { MapState } from '../types'
import { fileState, finish, relTo, rows, touch, workerEdits } from './map'

const empty: MapState = { agents: [], edits: {}, reviewed: {}, files: [], open: [], shut: [] }
const main = { id: 'main', name: 'Claude', kind: 'main' as const }
const sub = { id: 's:1', name: 'tests', kind: 'sub' as const }

test('editing a file makes it red; moving on turns the old one green', () => {
  let m = touch(empty, main, 'src/a.ts', 1)
  expect(fileState(m, 'src/a.ts')).toBe('active')
  m = touch(m, main, 'src/b.ts', 2)
  expect([fileState(m, 'src/a.ts'), fileState(m, 'src/b.ts')]).toEqual(['done', 'active'])
})

test('finishing clears the agent; its last file goes green', () => {
  const m = finish(touch(empty, main, 'src/a.ts', 1), 'main')
  expect(fileState(m, 'src/a.ts')).toBe('done')
  expect(m.agents.find(a => a.id === 'main')?.file).toBe(null)
})

test('two agents on one file: red until both leave it', () => {
  let m = touch(touch(empty, main, 'x.ts', 1), sub, 'x.ts', 2)
  m = finish(m, 'main')
  expect(fileState(m, 'x.ts')).toBe('active')
  expect(fileState(finish(m, 's:1'), 'x.ts')).toBe('done')
})

test('reviewed files stay plain until edited again', () => {
  let m = finish(touch(empty, main, 'a.ts', 1), 'main')
  m = { ...m, reviewed: { 'a.ts': 5 } }
  expect(fileState(m, 'a.ts')).toBe(null)
  expect(fileState(finish(touch(m, main, 'a.ts', 9), 'main'), 'a.ts')).toBe('done')
})

test('worker transcripts give their edits in order', () => {
  const row = (ts: string, name: string, input: object) =>
    JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_use', id: 'u', name, input }] } })
  const jsonl = [
    '{"cut',
    row('2026-10-10T10:00:00Z', 'Read', { file_path: '/p/a.ts' }),
    row('2026-10-10T10:00:01Z', 'Edit', { file_path: '/p/a.ts' }),
    row('2026-10-10T10:00:02Z', 'Write', { file_path: '/p/b.ts' }),
    row('2026-10-10T10:00:03Z', 'NotebookEdit', { notebook_path: '/p/n.ipynb' }),
  ].join('\n')
  expect(workerEdits(jsonl).map(e => e.path)).toEqual(['/p/a.ts', '/p/b.ts', '/p/n.ipynb'])
  expect(relTo('/p', '/p/a.ts')).toBe('a.ts')
  expect(relTo('/p', '/elsewhere/x.ts')).toBe('/elsewhere/x.ts')
})

test('tree: folders above marked files open, quiet folders collapse with a count', () => {
  const m = { ...touch(empty, main, 'src/lib/a.ts', 1), files: ['src/lib/a.ts', 'src/lib/b.ts', 'docs/x.md', 'docs/y.md', 'README.md'] }
  const r = rows(m).rows.map(x => `${'  '.repeat(x.depth)}${x.isDir ? (x.isOpen ? '▾' : '▸') : ''}${x.name}${x.isDir && !x.isOpen ? `(${x.count})` : ''}${x.state ? `:${x.state}` : ''}`)
  expect(r).toEqual(['▸docs(2)', '▾src', '  ▾lib', '    a.ts:active', '    b.ts', 'README.md'])
  // the person shuts src: it stays shut even with activity inside
  expect(rows({ ...m, shut: ['src'] }).rows.map(x => x.name)).toEqual(['docs', 'src', 'README.md'])
})
