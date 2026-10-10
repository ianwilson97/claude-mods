import { test, expect } from 'claude-code/testing'

import { summarize } from './register'

const TSV = `date\ttask_id\tjob\tattempt\tmodel\tinput_tok\tcache_read_tok\toutput_tok\tcost_usd\tverdict\tescalated\tshadow
2026-10-03\t001-http-parse-tests\tchore\t1\tm\t1\t1\t1\t0.0279\tfail\t0\t-
2026-10-03\t001-http-parse-tests-r1\tchore\t2\tm\t1\t1\t1\t0.0905\tpass\t0\t-
2026-10-03\t004-memory-tests\tchore\t1\tm\t1\t1\t1\t0.0246\tfail\t1\t-
2026-10-03\t003-macos-stats-apis\tresearch\t1\tm\t1\t1\t1\t0.1724\tpass\t0\tagree
`

test('summarizes jobs, running tasks and recent rows', () => {
  const s = summarize(TSV, ['001-http-parse-tests.md', '011-new-chore.md'], ['001-http-parse-tests.md'])
  expect(s.running).toEqual(['011-new-chore'])
  expect(s.cost.toFixed(4)).toBe("0.3154")
  const chore = s.jobs.find(j => j.job === 'chore')
  expect([chore?.runs, chore?.fails, chore?.escalated]).toEqual([3, 2, 1])
  expect(s.recent[0]?.taskId).toBe('003-macos-stats-apis')
})

test('empty tsv is fine', () => {
  const s = summarize('date\ttask_id\n', [], [])
  expect(s).toEqual({ running: [], recent: [], jobs: [], cost: 0 })
})
