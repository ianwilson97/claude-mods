import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Evidence } from '../types'

const evidence = atom({ plugin: 'evidence-band', key: 'evidence' } as const, {
  isAudit: false,
  code: [],
  docs: [],
} as Evidence)

const AUDIT = /\b(status|audit|sprint|smells?|review|tracker|is .* (done|complete)|what'?s left)\b/i
// ponytail: path heuristic; extend when a project keeps requirements elsewhere
const DOC = /(^|\/)(docs?|adr|specs?|\.planning|\.driver-seat)\/|(^|\/)(README|CHANGELOG|ROADMAP|TODO|CLAUDE)[^/]*$|tracker|\.mdx?$/i
const READ_CMD = /^\s*(cat|head|tail|sed|grep|rg|less|bat|wc)\b/
const PATHISH = /^[\w.~\/-]+\.[\w]+$|\//

const CITE = `# Evidence rule (enforced by a plugin)
This prompt asks for status, an audit or a review. Before answering:
- Read the project's docs (README, docs/, specs, tracker) AND the code they describe.
- Every finding or status claim cites both: the doc section and the file:line.
- Drop any finding a doc explicitly requires. Say plainly what you did not verify.`

export function sort(paths: readonly string[], e: Evidence): Evidence {
  const add = (list: string[], p: string) => (list.includes(p) ? list : [...list, p])
  return paths.reduce(
    (acc, p) => (DOC.test(p) ? { ...acc, docs: add(acc.docs, p) } : { ...acc, code: add(acc.code, p) }),
    e,
  )
}

export function bashPaths(command: string): string[] {
  if (!READ_CMD.test(command)) return []
  return command
    .split(/[\s|;&]+/)
    .slice(1)
    .filter(t => !t.startsWith('-') && PATHISH.test(t))
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    await update($, evidence, () => ({ isAudit: AUDIT.test(e.text), code: [], docs: [] }))
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, evidence)).isAudit) return composed
    return {
      sections: [...composed.sections, { id: 'evidence-band:cite', text: CITE, scope: 'session' as const }],
    }
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    await update($, evidence, ev => sort([e.file_path], ev))
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const paths = bashPaths(e.command)
    if (paths.length > 0) await update($, evidence, ev => sort(paths, ev))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ev = await read($, evidence)
    if (ev.isAudit && (ev.docs.length === 0 || ev.code.length === 0)) {
      $.ui.toast(`Audit answer without reading ${ev.docs.length === 0 ? 'docs' : 'code'}. Ask for evidence.`)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ev = await read($, evidence)
    if (!ev.isAudit || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const mark = (n: number) => (n > 0 ? `✓${n}` : '✗')
    return (
      <Box flexDirection="column">
        <Text dimColor>
          evidence · code {mark(ev.code.length)} · docs {mark(ev.docs.length)}
        </Text>
        {await next(e)}
      </Box>
    )
  })
}
