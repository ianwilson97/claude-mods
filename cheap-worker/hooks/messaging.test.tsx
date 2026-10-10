import { mock, test, expect } from 'claude-code/testing'
import type { Engine, On } from 'claude-code/testing'

// assets/providers/deepseek.png, so the engine's PNG check sees a real image
const DEEPSEEK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAJFBMVEVHcExNa/5Na/5Nav1Na/5Na/5Na/5Na/5Na/5Na/5Na/5Na/5wJ/S4AAAAC3RSTlMAx94TQvSsdluSJwUKMW4AAAIOSURBVFiF7VZJgsQgCHTB/f//najRAGI6mTlOc0pUyqIAVamvfe2l2T/6xJLfOUMypRQz/01Jn51yhghw7ATelWoO5tTxcx9ETqY7HSvHB2IdKx2GAOgfTBFMXwtCG/BUFT8+rZbcsQIqnUOAIQcAyO6HRcagR2Vj8k2kdIW3s6n83MRPMqWED/u3KM6o7RhwKNxMZjY2MinIZHYTzGBHNBJxbqxL6flwT/ID/8GBlUpX5wmBiUCiPdUVC3CLcCXQ9QzWFnloEVWM8bPAQv9PXn+kkqaOuK39ZHfUp3e3CC5atwDUfXFPLkXhQljGMIAruL/U2tYVHRizyADw/5JYH456zxQBGECgAMoSEqaup8lSDMArbqhog2rzuOMNBzALAC4Y3RkiJcnh3NgK530qzAEFQUTXRRCBRcG63q07CTGQJtEZK0sl6+JIdxY5qHChg7BszYPaHrWcrt5SWE+gZqzsxoUjASiptxa9rIzbTDrvYVnVMy5fvGnxF274k4JeZ9R64IkJP7vvkiEWPYjyE09+IBjGruZP5+v7TgCyzYiiBxUIv73SeBt9MuzanW+Jqxpkmeg2AVEYt+qF4NL2nTYRTMjWJoqHo9AbGXY3XF8fcUlKvV+Nn7yTtk4paDS5VXL3zmpEbA7H3eWM9lv/ynR3u+1YP4Twrx7ZwO5HE96/0SHq0xL85oX/tX9oPzfJQBauYBFiAAAAAElFTkSuQmCC'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="5" width="9" height="1" fill="#4d6bfe"/></svg>'
const VIEW = { component: 'Pane', requestId: 'cheap-workers', props: { title: 'Workers' } } as never
const PICKER = { component: 'Pane', requestId: 'cheap-worker', props: { title: 'Cheap worker' } } as never
const run = ($: Engine, command: string) => $.command.run({ command, args: '' } as never)

// tmux with one worker pane; records every argv, and the zsh key check passes.
function host(on: On) {
  const calls: string[] = []
  on('process.run', ($, e) => {
    const argv = (e as { argv: string[] }).argv
    calls.push(argv.join(' '))
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never
    if (argv[1] === 'list-panes') return ok(argv.at(-1)?.includes('@cw_model') ? '%3\tcw-abc\tdeepseek/deepseek-v4.1-flash\tacceptEdits\t\t\t' : '%3')
    if (argv[1] === 'list-windows') return ok('workers')
    if (argv[1] === 'split-window') return ok('%9\n')
    return ok()
  })
  on('ui.open', ($, e) => ({ value: { id: e.id } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.cwd', () => ({ value: '/Users/ianwilson/Apps/demo' }) as never)
  on('http.fetch', () => ({ value: { status: 503, ok: false, headers: {}, text: '' } }) as never)
  return calls
}

test('a worker message here is logged, shown and still reaches the model', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T21:22:00') })
  host(on)
  let modelSaw = ''
  on('session.receive', ($, e) => {
    modelSaw = e.text
    return { text: e.text } as never
  })
  await $.session.receive({
    origin: { kind: 'peer' },
    text: '<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="cw-ping" from-mode="prompting">\npingpong ok 7341\n</cross-session-message>',
  } as never)
  expect(modelSaw).toContain('pingpong ok 7341')

  await run($, 'workers')
  const ui = await $.ui.mount({ plugin: 'cheap-worker', surface: 'terminal', ...VIEW })
  expect(await ui.find({ type: 'Text', text: /← 21:22 cw-ping: pingpong ok 7341/ })).toBeDefined()
  await ui.unmount()
})

test('typing in a worker card sends it a message', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T21:30:00') })
  host(on)
  const sent: { to: string; text: string }[] = []
  on('session.send', ($, e) => {
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true } as never
  })
  await run($, 'workers')
  const ui = await $.ui.mount({ plugin: 'cheap-worker', surface: 'terminal', ...VIEW })
  await ui.input({ key: 'msg-%3', text: 'status?' })
  expect(sent).toEqual([{ to: 'cw-abc', text: 'status?' }])
  expect(await ui.find({ type: 'Text', text: /→ 21:30 cw-abc: status\?/ })).toBeDefined()
  await ui.unmount()
})

test('team launch puts teammates and the lead into the worker prompt', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T21:40:00') })
  const calls = host(on)
  on('tool.call', () => ({ result: 'This session is Useful mods for workflows [141cc2] — the name other sessions use' }) as never)
  await run($, 'workers') // learn about cw-abc
  const ui = await $.ui.mount({ plugin: 'cheap-worker', surface: 'terminal', ...PICKER })
  await ui.press({ key: 'team-toggle' })
  await ui.input({ key: 'task', text: 'review parser.rs' })
  const spawn = calls.find(c => c.startsWith('tmux split-window')) ?? ''
  expect(spawn).toContain('a worker on a team')
  expect(spawn).toContain('Teammates right now: cw-abc')
  expect(spawn).toContain('Useful mods for workflows')
  expect(spawn).toContain('Task: review parser.rs')
  await ui.unmount()
})

test('panes still draw on mobile, which has no text input', async ($, on) => {
  mock.clock(on, { now: 0 })
  host(on)
  await run($, 'workers')
  for (const target of [VIEW, PICKER]) {
    const ui = await $.ui.mount({ plugin: 'cheap-worker', surface: 'mobile', ...(target as object) } as never)
    expect(await ui.find({ type: 'Button' })).toBeDefined()
    await ui.unmount()
  }
})

test('cards: provider logo, mode word, transcript stats and totals', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-08T22:00:00') })
  const calls: string[] = []
  on('ui.open', ($, e) => ({ value: { id: e.id } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.cwd', () => ({ value: '/Users/ianwilson/Apps/demo' }) as never)
  const jsonl = [
    JSON.stringify({ type: 'agent-name', agentName: 'x' }),
    JSON.stringify({ type: 'assistant', message: { id: 'g1', usage: { input_tokens: 30000, cache_read_input_tokens: 8000, output_tokens: 400 } } }),
  ].join('\n')
  on('env.get', () => ({ value: '/Users/ian' }) as never)
  on('fs.read', ($, e) => {
    const path = String((e as { path?: string }).path ?? '')
    if (path.endsWith('.svg')) return { value: SVG } as never
    if (path.endsWith('providers-px.json')) return { value: JSON.stringify({ deepseek: Array.from({ length: 8 }, () => Array(8).fill('#4d6bfe')) }) } as never
    return (path.endsWith('.png') ? { value: { base64: DEEPSEEK_PNG } } : { value: jsonl }) as never
  })
  on('http.fetch', () =>
    ({
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({
          data: [{ id: 'deepseek/deepseek-v4.1-flash', context_length: 100000, pricing: { prompt: '0.0000003', completion: '0.0000012', input_cache_read: '0.00000003' }, supported_parameters: ['tools'] }],
        }),
      },
    }) as never,
  )
  // grep finds the transcript; list-panes reports the new pane %9 live
  on('process.run', ($, e) => {
    const argv = (e as { argv: string[] }).argv
    calls.push(argv.join(' '))
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never
    if (argv[0] === 'grep') return ok('/Users/ian/.claude/projects/-Users-ianwilson-Apps-demo/abc.jsonl\n')
    if (argv[1] === 'list-panes') return ok(argv.at(-1)?.includes('@cw_model') ? '%9\tcw-test\tdeepseek/deepseek-v4.1-flash\tacceptEdits\t\t\t' : '%9')
    if (argv[1] === 'list-windows') return ok('workers')
    if (argv[1] === 'split-window') return ok('%9\n')
    if (argv[1] === 'capture-pane') return ok('⏺ Writing parser.rs\n✳ Churning… · esc to interrupt\n')
    return ok()
  })
  const picker = await $.ui.mount({ plugin: 'cheap-worker', surface: 'terminal', ...PICKER })
  await run($, 'worker') // loads the catalog
  await picker.input({ key: 'task', text: 'build the parser' })
  await picker.unmount()
  await run($, 'workers')

  const ui = await $.ui.mount({ plugin: 'cheap-worker', surface: 'terminal', ...VIEW })
  // terminal: the logo is half-block text (an Image would print its alt in terminals without graphics)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^▀{8}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^build the parser$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^edits$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctx 38% · 38k · ≈\$0\.01/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^38k$/ })).toBeDefined() // Tokens tile
  expect(await ui.find({ type: 'Text', text: /^●$/ })).toBeDefined() // working
  await ui.unmount()

  // the desktop app has no Image: the pixel-art SVG trace stands in
  const desk = await $.ui.mount({ plugin: 'cheap-worker', surface: 'desktop', ...VIEW })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  expect(await desk.find({ type: 'Image' })).toBeUndefined()
  await desk.unmount()
})
