import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { JobStats, Row, Summary } from '../types'

const PANE = 'cw'
const DIR = '.driver-seat'
const summary = atom({ plugin: 'cw-pane', key: 'summary' } as const, null as Summary | null)

// The driver-seat rule: revisit the model split at 20%+ escalated after 10 runs of a job.
const isHot = (j: JobStats) => j.runs >= 10 && j.escalated / j.runs >= 0.2

export function summarize(tsv: string, tasks: readonly string[], results: readonly string[]): Summary {
  const lines = tsv.trim().split('\n').slice(1).filter(Boolean)
  const rows: Row[] = lines.map(line => {
    const c = line.split('\t')
    return {
      taskId: c[1] ?? '?',
      job: c[2] ?? '?',
      cost: Number(c[8]) || 0,
      verdict: c[9] ?? '?',
      escalated: c[10] === '1',
    }
  })
  const jobs = new Map<string, JobStats>()
  for (const r of rows) {
    const j = jobs.get(r.job) ?? { job: r.job, runs: 0, fails: 0, escalated: 0, cost: 0 }
    jobs.set(r.job, {
      ...j,
      runs: j.runs + 1,
      fails: j.fails + (r.verdict === 'fail' ? 1 : 0),
      escalated: j.escalated + (r.escalated ? 1 : 0),
      cost: j.cost + r.cost,
    })
  }
  const done = new Set(results)
  return {
    running: tasks.filter(t => !done.has(t)).map(t => t.replace(/\.md$/, '')),
    recent: rows.slice(-8).reverse(),
    jobs: [...jobs.values()],
    cost: rows.reduce((sum, r) => sum + r.cost, 0),
  }
}

async function refresh($: EngineInterface) {
  const tsv = await $.fs.read(`${DIR}/workers.tsv`).catch(() => null)
  if (typeof tsv !== 'string') return update($, summary, () => null)
  const names = async (d: string) =>
    (await $.fs.list(`${DIR}/${d}`).catch(() => [])).filter(e => e.name.endsWith('.md')).map(e => e.name)
  const next = summarize(tsv, await names('tasks'), await names('results'))
  await update($, summary, () => next)
  $.ui.status(next.running.length > 0 ? `cw: ${next.running.length} running` : undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cw-pane', description: 'Show driver-seat cheap workers in a pane' })
    await refresh($)
    $.clock.every(5000, () => refresh($)) // ponytail: polls fs; switch to a watcher if it ever lags
    return next(e)
  })

  on('command.run', { command: 'cw-pane' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Cheap workers' })
    return { text: 'Cheap workers pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, summary)
    if (s === null) return <Text dimColor>No .driver-seat/workers.tsv in this project.</Text>
    const pct = (n: number, d: number) => (d === 0 ? '0%' : `${Math.round((100 * n) / d)}%`)
    return (
      <Box flexDirection="column">
        <Text bold>Running ({s.running.length})</Text>
        {s.running.length === 0 && <Text dimColor>  none</Text>}
        {s.running.map(t => (
          <Text key={`run-${t}`} color="yellow">  ● {t}</Text>
        ))}
        <Text bold>Jobs · total ${s.cost.toFixed(2)}</Text>
        {s.jobs.map(j => (
          <Text key={`job-${j.job}`} color={isHot(j) ? 'red' : undefined}>
            {'  '}{j.job.padEnd(9)} {String(j.runs).padStart(3)} runs · fail {pct(j.fails, j.runs)} · esc{' '}
            {pct(j.escalated, j.runs)} · ${j.cost.toFixed(2)}{isHot(j) ? '  ← revisit model' : ''}
          </Text>
        ))}
        <Text bold>Recent</Text>
        {s.recent.map((r, i) => (
          <Text key={`row-${i}`} dimColor={r.verdict === 'pass'} color={r.verdict === 'fail' ? 'red' : undefined}>
            {'  '}{r.verdict.padEnd(4)} {r.taskId} ${r.cost.toFixed(3)}{r.escalated ? ' ↑esc' : ''}
          </Text>
        ))}
      </Box>
    )
  })
}
