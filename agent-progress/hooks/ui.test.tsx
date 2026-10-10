import { mock, test, expect } from 'claude-code/testing'

const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const
const PANE = { component: 'Pane', requestId: 'agent-progress', props: { title: 'Agent progress' } } as const
const TRANSCRIPT = [
  JSON.stringify({ type: 'assistant', timestamp: '2026-10-10T10:00:00.000Z', message: { content: [{ type: 'tool_use', id: 'u1', name: 'TodoWrite', input: { todos: [
    { content: 'Scan repo', activeForm: 'Scanning repo', status: 'completed' },
    { content: 'Write fix', activeForm: 'Writing fix', status: 'in_progress' },
    { content: 'Run tests', activeForm: 'Running tests', status: 'pending' },
    { content: 'Report', activeForm: 'Reporting', status: 'pending' },
  ] } }] } }),
].join('\n')

// The engine beneath the plugin: one cw worker in tmux, its transcript, no subagents.
function engine(on: Parameters<typeof mock.clock>[0]) {
  const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never
  on('process.run', ($, e) => {
    const argv = (e as { argv: string[] }).argv
    if (argv[0] === 'tmux') return ok(`%5\tcw-ab12\tqwen/qwen3-coder\tauto\t${Date.parse('2026-10-10T09:59:00.000Z')}\t/Users/me/app\tfix it\n`)
    if (argv[0] === 'grep') return ok('/home/.claude/projects/-Users-me-app/w.jsonl\n')
    if (argv[0] === 'tail') return ok(TRANSCRIPT)
    return ok()
  })
  on('env.get', () => ({ value: '/home' }) as never)
  on('fs.read', () => ({ value: '' }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('ui.open', ($, e) => ({ value: { id: e.id } }) as never)
  on('tool.call', ($, e) => ({ result: { oldTodos: [], newTodos: (e as unknown as { todos: unknown }).todos } }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">? for shortcuts</Text>
  })
}
const todos = (done: number, total: number) =>
  Array.from({ length: total }, (_, i) => ({ content: `step ${i}`, activeForm: `doing ${i}`, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending' }))

test('footer chip shows the main bar; the pane lists the main agent and a worker', async ($, on) => {
  engine(on)
  mock.clock(on, { now: Date.parse('2026-10-10T10:01:00.000Z') })
  await $.tool.call({ tool: 'TodoWrite', todos: todos(2, 5) } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const hint = await $.ui.mount({ plugin: 'agent-progress', surface, ...HINT })
    expect((await hint.find({ type: 'Text', text: / 2\/5$/ }))).toBeDefined()
    await hint.press({ key: 'progress-open' })
    await hint.unmount()
    const ui = await $.ui.mount({ plugin: 'agent-progress', surface, ...PANE } as never)
    expect(await ui.find({ type: 'Text', text: 'THIS SESSION' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'doing 2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'cw-ab12' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Writing fix' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1/4' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'auto' })).toBeDefined()
    // terminal: a keyed Raster (what blit addresses); desktop: an Svg per bar (the kit finds Svgs by type)
    if (surface === 'terminal') expect((await ui.find({ key: 'bar-main' }))?.type).toBe('Raster')
    else expect((await ui.findAll({ type: 'Svg' } as never)).length).toBe(2)
    // workers tab hides this session's agents
    await ui.press({ key: 'tab-workers' })
    expect(await ui.find({ type: 'Text', text: 'THIS SESSION' })).toBeUndefined()
    await ui.press({ key: 'tab-all' })
    await ui.unmount()
  }
})

test('the frame clock blits while a bar slides, then stops for good', async ($, on) => {
  engine(on)
  // an hour after the worker's last transcript row: it's stalled, so it holds still
  const clock = mock.clock(on, { now: Date.parse('2026-10-10T11:00:00.000Z') })
  let blits = 0
  let redraws = 0
  on('ui.blit', () => {
    blits++
    return { value: {} } as never
  })
  on('ui.invalidate', () => {
    redraws++
    return { value: undefined } as never
  })
  await $.tool.call({ tool: 'TodoWrite', todos: todos(0, 4) } as never)
  const hint = await $.ui.mount({ plugin: 'agent-progress', surface: 'terminal', ...HINT })
  await hint.press({ key: 'progress-open' })
  const ui = await $.ui.mount({ plugin: 'agent-progress', surface: 'terminal', ...PANE } as never)
  await $.tool.call({ tool: 'TodoWrite', todos: todos(2, 4) } as never) // 0% → 50%: slide
  for (let i = 0; i < 40; i++) {
    clock.advance(33)
    await clock.settle()
  }
  expect(blits).toBeGreaterThan(5)
  expect(redraws).toBeGreaterThan(5)
  const [b, r] = [blits, redraws]
  for (let i = 0; i < 60; i++) {
    clock.advance(33)
    await clock.settle()
  }
  // main agent idle (no prompt in flight), worker stalled: nothing moves, so no frames at all
  expect([blits, redraws]).toEqual([b, r])
  await ui.unmount()
  await hint.unmount()
})
