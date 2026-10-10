import { mock, test, expect } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'agent-map', props: { title: 'Agent map' } } as const
const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const

function engine(on: Parameters<typeof mock.clock>[0]) {
  const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never
  on('process.run', ($, e) => ((e as { argv: string[] }).argv[0] === 'git' ? ok('src/a.ts\nsrc/b.ts\ndocs/x.md\n') : ok()))
  on('session.cwd', () => ({ value: '/proj' }) as never)
  on('env.get', () => ({ value: '/home' }) as never)
  on('agent.list', () => ({ value: [{ id: 'ag1', description: 'write tests', type: 'general-purpose', status: 'running' }] }) as never)
  on('ui.open', ($, e) => ({ value: { id: e.id } }) as never)
  on('tool.call', () => ({ result: { ok: true } }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">? for shortcuts</Text>
  })
  mock.clock(on, { now: 1000 })
}

test('an edit turns the file red with a hammer and Clawd; moving on turns it green ✓', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/a.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/proj/src/new.ts', content: 'x', agentId: 'ag1' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const hint = await $.ui.mount({ plugin: 'agent-map', surface, ...HINT })
    expect((await hint.find({ key: 'map-open' }))?.text).toBe('🔨 2')
    await hint.press({ key: 'map-open' })
    await hint.unmount()
    const ui = await $.ui.mount({ plugin: 'agent-map', surface, ...PANE } as never)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toContain('a.ts')
    expect(texts).toContain('🔨')
    expect(texts).toContain(' write tests') // the subagent's label beside its Clawd
    expect(texts.filter(t => t === '▐▛█▜▌').length).toBeGreaterThan(1)
    expect((await ui.find({ key: 'dir-docs' }))?.text).toBe('▸ docs/  (1)')
    await ui.unmount()
  }
  // the main agent moves on to b.ts: a.ts is done and offers a review mark
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/b.ts', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount({ plugin: 'agent-map', surface: 'terminal', ...PANE } as never)
  expect(await ui.find({ key: 'rv-src/a.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✓ 1 ready for review' })).toBeDefined()
  await ui.press({ key: 'rv-src/a.ts' })
  expect(await ui.find({ key: 'rv-src/a.ts' })).toBeUndefined()
  await ui.unmount()
})
