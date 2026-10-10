import { mock, test, expect } from 'claude-code/testing'

import { ghosttyTabScript, workerScript } from './worker'

const PICKER = { component: 'Pane', requestId: 'cheap-worker', props: { title: 'Cheap worker' } } as const

test('bedrock workers keep user settings (their Bedrock env) and run a Claude alias', () => {
  const s = workerScript({ name: 'cw-ab12c', model: 'anthropic/opus', mode: 'acceptEdits', task: "fix it's bug", provider: 'bedrock' })
  expect(s).toBe(`exec command claude -n cw-ab12c --model opus --strict-mcp-config --permission-mode acceptEdits 'fix it'\\''s bug'`)
  expect(s.includes('OPENROUTER')).toBe(false)
  expect(s.includes('--setting-sources')).toBe(false)
  expect(() => workerScript({ name: 'cw-x', model: 'deepseek/deepseek-v4.1-flash', mode: 'auto', task: '', provider: 'bedrock' })).toThrow()
  // openrouter is unchanged
  expect(workerScript({ name: 'cw-x', model: 'deepseek/deepseek-v4.1-flash', mode: 'auto', task: '' })).toContain('--setting-sources project,local')
})

test('the Ghostty tab script opens a tab, attaches, and hands focus back', () => {
  const s = ghosttyTabScript('cw-ab12c', '/opt/homebrew/bin/tmux')
  expect(s).toContain('new tab in w with configuration cfg')
  expect(s).toContain('set command of cfg to "/opt/homebrew/bin/tmux attach -t =cw-ab12c"')
  expect(s).toContain('select tab here')
  expect(() => ghosttyTabScript('cw-x"; do shell script "rm', '/opt/homebrew/bin/tmux')).toThrow()
  expect(() => ghosttyTabScript('cw-ab12c', 'tmux')).toThrow()
})

function host(on: Parameters<typeof mock.clock>[0], opts: { isTabOk: boolean; isInCmux?: boolean }) {
  const calls: string[] = []
  const toasts: string[] = []
  const ok = (stdout = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never
  on('process.run', ($, e) => {
    const argv = (e as { argv: string[] }).argv
    calls.push(argv.join(' '))
    if (argv[0] === 'osascript') return ok('', opts.isTabOk ? 0 : 1)
    if (argv[0] === '/Apps/cmux' && argv[1] === 'new-surface') return ok('OK surface:110 pane:38 workspace:14\n')
    if (argv[0] === 'zsh' && argv[2] === 'command -v tmux') return ok('/opt/homebrew/bin/tmux\n')
    if (argv[1] === 'new-session') return ok('%9\n')
    return ok()
  })
  on('session.cwd', () => ({ value: '/work/repo' }) as never)
  on('env.get', ($, e) => {
    const name = (e as { name: string }).name
    const env: Record<string, string> = opts.isInCmux ? { CMUX_WORKSPACE_ID: 'ws-1', CMUX_BUNDLED_CLI_PATH: '/Apps/cmux' } : {}
    return { value: env[name] } as never
  })
  on('ui.open', ($, e) => ({ value: { id: e.id } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', ($, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  mock.clock(on, { now: Date.parse('2026-10-10T12:00:00') })
  return { calls, toasts }
}

test('tabs + bedrock: own tmux session, a Ghostty tab, no OpenRouter key check', { options: { provider: 'bedrock', launch: 'tabs' } } as never, async ($, on) => {
  const h = host(on, { isTabOk: true })
  await $.command.run({ command: 'worker', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'cheap-worker', surface: 'terminal', ...PICKER } as never)
  expect(await ui.find({ type: 'Text', text: /via Amazon Bedrock/ })).toBeDefined()
  expect(await ui.find({ key: 'refresh' })).toBeUndefined() // no OpenRouter catalog
  await ui.press({ key: 'm-anthropic/opus' })
  await ui.input({ key: 'task', text: 'write the tests' })
  const spawn = h.calls.find(c => c.startsWith('tmux new-session')) ?? ''
  expect(spawn).toMatch(/^tmux new-session -d -s cw-[a-z0-9]+ /)
  expect(spawn).toContain('--model opus')
  expect(h.calls.some(c => c.includes('CW_OPENROUTER_API_KEY'))).toBe(false)
  expect(h.calls.some(c => c.startsWith('tmux split-window'))).toBe(false)
  expect(h.calls.some(c => c.startsWith('osascript -e tell application "Ghostty"'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /opened in a new tab/ })).toBeDefined()
  await ui.unmount()
})

test('tabs: when the tab can\'t be opened (automation blocked), say how to reach it', { options: { provider: 'bedrock', launch: 'tabs' } } as never, async ($, on) => {
  const h = host(on, { isTabOk: false })
  await $.command.run({ command: 'worker', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'cheap-worker', surface: 'terminal', ...PICKER } as never)
  await ui.input({ key: 'task', text: 'triage' })
  expect(h.toasts.some(t => /CMD\+T, then {2}crew [a-z0-9]+/.test(t))).toBe(true)
  await ui.unmount()
})

test('inside cmux: a background cmux tab, named after the worker, typed the attach', { options: { provider: 'bedrock', launch: 'tabs' } } as never, async ($, on) => {
  const h = host(on, { isTabOk: true, isInCmux: true })
  await $.command.run({ command: 'worker', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'cheap-worker', surface: 'terminal', ...PICKER } as never)
  await ui.input({ key: 'task', text: 'triage' })
  const name = (h.calls.find(c => c.startsWith('tmux new-session')) ?? '').match(/-s (cw-[a-z0-9]+)/)?.[1]
  expect(h.calls).toContain('/Apps/cmux new-surface --type terminal --focus false')
  expect(h.calls).toContain(`/Apps/cmux rename-tab --surface surface:110 ${name}`)
  expect(h.calls).toContain(`/Apps/cmux send --surface surface:110 /opt/homebrew/bin/tmux attach -t '=${name}'\n`)
  expect(h.calls.some(c => c.startsWith('osascript'))).toBe(false)
  expect(await ui.find({ type: 'Text', text: /opened in a new tab/ })).toBeDefined()
  await ui.unmount()
})
