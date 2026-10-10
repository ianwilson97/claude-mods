import { mock, test, expect } from 'claude-code/testing'
import type { On } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'cheap-worker', props: { title: 'Cheap worker' } } as never

test('starring a model pins it, persists it and marks it', async ($, on) => {
  const saved: unknown[] = []
  on('store.get', () => ({ value: undefined }) as never)
  on('store.set', ($, e) => {
    saved.push((e as { value: unknown }).value)
    return { value: undefined } as never
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'cheap-worker', surface, ...PANE })
    const before = (await ui.find({ key: 'pin-deepseek/deepseek-v4.1-flash' }))?.text
    await ui.press({ key: 'pin-deepseek/deepseek-v4.1-flash' })
    const after = (await ui.find({ key: 'pin-deepseek/deepseek-v4.1-flash' }))?.text
    expect(before === '☆' ? after : before).toBe('★')
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    await ui.unmount()
  }
  // pinned on the first surface, unpinned on the second: each change saved
  expect(saved).toEqual([['deepseek/deepseek-v4.1-flash'], []])
})

test('footer worker button opens the pane on terminal and desktop', async ($, on) => {
  let opened = ''
  on('ui.open', ($, e) => {
    opened = e.id
    return { value: { id: e.id } } as never
  })
  on('http.fetch', () => ({ value: { status: 503, ok: false, headers: {}, text: '' } }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">? for shortcuts</Text>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    opened = ''
    const ui = await $.ui.mount({
      plugin: 'cheap-worker',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect((await ui.find({ key: 'worker-open' }))?.text).toBe('worker')
    expect(await ui.find({ type: 'Text', text: /shortcuts/ })).toBeDefined()
    await ui.press({ key: 'worker-open' })
    expect(opened).toBe('cheap-worker')
    await ui.unmount()
  }
})

const VIEW = { component: 'Pane', requestId: 'cheap-workers', props: { title: 'Workers' } } as never

// A tmux that knows two worker panes; one ignores /exit (mid-turn), so it needs the force-kill.
function fakeTmux(on: On) {
  const panes = new Map([
    ['%3', 'cw-abc'],
    ['%7', 'cw-003-tests'],
  ])
  const calls: string[] = []
  on('process.run', ($, e) => {
    const argv = (e as { argv: string[] }).argv
    calls.push(argv.join(' '))
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never
    if (argv[1] === 'list-panes') {
      const meta = argv.at(-1)?.includes('@cw_model')
      return ok([...panes].map(([id, name]) => (meta ? `${id}\t${name}\tdeepseek/deepseek-v4.1-flash\tacceptEdits\t\t\t` : id)).join('\n'))
    }
    if (argv[1] === 'display-message') return ok('4242\n')
    if (argv[1] === 'capture-pane') return ok('⏺ Reading src/parser.rs\n✳ Churning…\n❯ \n')
    if (argv[1] === 'kill-pane') panes.delete(argv[3] as string)
    return ok()
  })
  return { calls, panes }
}

test('workers view lists tmux workers, closes with /exit then force-kills', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const tmux = fakeTmux(on)
  on('ui.open', ($, e) => ({ value: { id: e.id } }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  await $.command.run({ command: 'workers', args: '' } as never)

  const ui = await $.ui.mount({ plugin: 'cheap-worker', surface: 'terminal', ...VIEW })
  expect(await ui.find({ type: 'Text', text: /Running · 2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cw-003-tests/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Churning/ })).toBeDefined() // newest output line

  await ui.press({ key: 'close-%3' })
  expect(tmux.calls).toContain('tmux send-keys -t %3 -l /exit')
  expect(await ui.find({ type: 'Text', text: /◌ closing/ })).toBeDefined()
  expect(await ui.find({ key: 'close-%3' })).toBeUndefined()
  expect(tmux.calls.some(c => c.startsWith('tmux kill-pane'))).toBe(false)

  await clock.advance(6000)
  await clock.settle()
  expect(tmux.calls).toContain('kill 4242')
  expect(tmux.calls.indexOf('kill 4242')).toBeLessThan(tmux.calls.indexOf('tmux kill-pane -t %3'))
  expect(await ui.find({ type: 'Text', text: /Running · 1/ })).toBeDefined()
  await ui.unmount()
})

test('footer still draws while workers are live', async ($, on) => {
  mock.clock(on, { now: 0 })
  fakeTmux(on)
  on('ui.open', ($, e) => ({ value: { id: e.id } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">? for shortcuts</Text>
  })
  await $.command.run({ command: 'workers', args: '' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'cheap-worker',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect((await ui.find({ key: 'worker-open' }))?.text).toBe('worker')
    expect((await ui.find({ key: 'workers-view' }))?.text).toBe('· 2 live')
    await ui.unmount()
  }
})
