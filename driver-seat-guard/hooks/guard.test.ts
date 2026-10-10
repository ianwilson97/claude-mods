import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: [],
  tools: [],
  outputStyle: null,
  traits: [],
}
const origin = { kind: 'composer' } as const
const learn = ($: Engine, args: string) =>
  $.command.run({ command: 'learn', args, origin, presentation: { isFullscreen: false, columns: 120 } })
const say = ($: Engine, text: string) => $.prompt.submit({ text, origin, wait: false })
const search = ($: Engine, query: string) => $.tool.call({ tool: 'WebSearch', query, mode: 'standard' })

test('web search blocked in learn mode unless asked', async ($, on) => {
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: 'ok' }))

  await learn($, '001')
  expect((await search($, 'rust http')).deny).toBeDefined()

  await say($, 'search the docs for httparse')
  expect((await search($, 'httparse')).deny).toBeUndefined()

  await learn($, 'off')
  await say($, 'next')
  expect((await search($, 'rust')).deny).toBeUndefined()
})

test('pacing section added only in learn mode', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }))
  const ids = async () => (await $.prompt.compose(COMPOSE)).sections.map(s => s.id)
  expect(await ids()).not.toContain('driver-seat-guard:pacing')
  await learn($, '002')
  expect(await ids()).toContain('driver-seat-guard:pacing')
})
