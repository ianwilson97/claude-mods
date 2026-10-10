import { test, expect } from 'claude-code/testing'
import type { Engine, On } from 'claude-code/testing'

import { modelAlias } from './controls'

const PANE = { component: 'Pane', requestId: 'quick-settings', props: { title: 'Quick settings' } } as const

// Stands in for the engine: a session model that /model may or may not change.
function engine(on: On, opts: { modelSticks: boolean }) {
  let current = 'claude-opus-5-5'
  const ran: string[] = []
  on('session.model', () => ({ value: current }))
  on('command.run', ($, e) => {
    ran.push(`/${e.command} ${e.args}`)
    if (e.command === 'model' && opts.modelSticks) current = `claude-${e.args}-5-5`
    return { text: 'ok' }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return ran
}

const step = async ($: Engine, effort: string) => {
  // Drains the stream; the stand-in beneath records what was sent.
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: effort as never, messageCount: 1 } as never) as AsyncIterable<unknown>);
}

test('aliases full model ids', () => {
  expect([modelAlias('claude-sonnet-5-5'), modelAlias('claude-haiku-4-5-20251001'), modelAlias('x')]).toEqual([
    'sonnet',
    'haiku',
    'x',
  ])
})

test('pane switches the model through /model on terminal and desktop', async ($, on) => {
  const ran = engine(on, { modelSticks: true })
  const first = await $.ui.mount({ plugin: 'quick-settings', surface: 'terminal', ...PANE })
  expect((await first.find({ key: 'model-opus' }))?.text).toBe('● opus')
  await first.unmount()
  const picks = { terminal: 'sonnet', desktop: 'fable' } as const
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'quick-settings', surface, ...PANE })
    const pick = picks[surface]
    expect((await ui.find({ key: `model-${pick}` }))?.text).toContain('○')
    await ui.press({ key: `model-${pick}` })
    expect((await ui.find({ key: `model-${pick}` }))?.text).toContain('●')
    expect(await ui.find({ type: 'Text', text: new RegExp(`Model set to ${pick}`) })).toBeDefined()
    await ui.unmount()
  }
  expect(ran).toEqual(['/model sonnet', '/model fable'])
})

test('falls back to a per-request override when /model does not take', async ($, on) => {
  engine(on, { modelSticks: false })
  let sentModel = ''
  on('turn.step', async function* ($, e) {
    sentModel = e.model
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })
  const ui = await $.ui.mount({ plugin: 'quick-settings', surface: 'terminal', ...PANE })
  await ui.press({ key: 'model-haiku' })
  expect(await ui.find({ type: 'Text', text: /per-request override: haiku/ })).toBeDefined()
  await ui.unmount()
  await step($, 'high')
  expect(sentModel).toBe('haiku')
})

test('footer button shows effort and model and opens the pane', async ($, on) => {
  engine(on, { modelSticks: true })
  let opened = ''
  on('ui.open', ($, e) => {
    opened = e.id
    return { value: { id: e.id } } as never
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'quick-settings',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect((await ui.find({ key: 'qs-open' }))?.text).toBe('⚙ effort · opus')
    await ui.press({ key: 'qs-open' })
    expect(opened).toBe('quick-settings')
    await ui.unmount()
  }
})
