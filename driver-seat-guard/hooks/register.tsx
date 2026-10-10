import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Guard } from '../types'

const guard = atom({ plugin: 'driver-seat-guard', key: 'guard' } as const, {
  isOn: false,
  todo: null,
  isSearchAsked: false,
} as Guard)

const TODOS = '.driver-seat/todos'
const SEARCH_ASK = /\b(search|look (it|this|that) up|google|web|check the docs)\b/i

const PACING = (todo: string | null) => `# Driver-seat learn mode (enforced by a plugin)
The user writes the code. You tutor.
- Give ONLY the next single step: 3-6 sentences, one tiny concrete example.
- Do not explain later steps, write tests for later todos, or start workers.
- If the user says they don't understand, answer simpler and shorter, not reworded.
- Web search/fetch is blocked unless the user's latest prompt asks for it.
${todo ? `- Active todo: ${todo}. Stay inside it until the user says to move on.` : '- No active todo set.'}`

// Finds the NNN of the todo whose frontmatter says `status: doing`.
async function doingTodo($: EngineInterface): Promise<string | null> {
  const entries = await $.fs.list(TODOS).catch(() => [])
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
    const text = await $.fs.read(`${TODOS}/${entry.name}`).catch(() => '')
    if (typeof text === 'string' && /^status:\s*doing\b/m.test(text)) {
      return entry.name.match(/^\d+/)?.[0] ?? null
    }
  }
  return null
}

// True when `path` belongs to a todo other than `active` (e.g. a red test for 003
// while 001 is in progress). Return false to allow the write.
export function isOffTodo(path: string, active: string): boolean {
  // TODO(driver): your rule. See the request in chat.
  return false
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'learn',
      description: 'Learn mode: /learn [todo NNN] on, /learn off',
    })
    return next(e)
  })

  on('command.run', { command: 'learn' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off') {
      await update($, guard, g => ({ ...g, isOn: false }))
      return { text: 'Learn mode off.' }
    }
    const todo = arg.match(/^\d+$/) ? arg : await doingTodo($)
    await update($, guard, g => ({ ...g, isOn: true, todo }))
    return { text: `Learn mode on. Active todo: ${todo ?? 'none (pass /learn NNN)'}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, guard, g => ({ ...g, isSearchAsked: SEARCH_ASK.test(e.text) }))
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const g = await read($, guard)
    if (!g.isOn) return composed
    return {
      sections: [
        ...composed.sections,
        { id: 'driver-seat-guard:pacing', text: PACING(g.todo), scope: 'session' as const },
      ],
    }
  })

  on('tool.call', { tool: ['WebSearch', 'WebFetch'] }, async ($, e, next) => {
    const g = await read($, guard)
    return g.isOn && !g.isSearchAsked
      ? { deny: `driver-seat-guard: learn mode, no ${e.tool} unless the user asks for a search.` }
      : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'driver-seat-guard: guard failed.' }))

  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const g = await read($, guard)
    return g.isOn && g.todo && isOffTodo(e.file_path, g.todo)
      ? { deny: `driver-seat-guard: ${e.file_path} belongs to a later todo; active is ${g.todo}.` }
      : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'driver-seat-guard: guard failed.' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const g = await read($, guard)
    if (!g.isOn || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text dimColor>LEARN · todo {g.todo ?? 'none'} · /learn off to exit</Text>
        {await next(e)}
      </Box>
    )
  })
}
