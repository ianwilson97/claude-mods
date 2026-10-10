import { test, expect } from 'claude-code/testing'

import { bannerModel, parseMeta, choicesFor, clockDur, costOf, isRetired, isSlug, isWorking, kfmt, leadFrom, parseModels, parsePanes, parsePeer, peekLines, projectDir, search, sq, teamPreamble, toPins, tokensOf, usageFrom, vendorOf, workerScript } from './worker'

test('slugs: OpenRouter ids pass, shell tricks do not', () => {
  expect(['deepseek/deepseek-v4.1-flash', 'qwen/qwen3-coder:free', 'x-ai/grok-5'].every(isSlug)).toBe(true)
  expect(['deepseek', 'a/b; rm -rf ~', 'a/$(id)', "a/b'c", ''].some(isSlug)).toBe(false)
})

test('sq survives quotes', () => {
  expect(sq("it's")).toBe(`'it'\\''s'`)
})

test('worker script references the key, never inlines it, and quotes the task', () => {
  const s = workerScript({ name: 'cw-abc', model: 'deepseek/deepseek-v4.1-flash', mode: 'auto', task: "fix the parser's bug; rm -rf /" })
  expect(s).toContain('ANTHROPIC_AUTH_TOKEN=$CW_OPENROUTER_API_KEY')
  expect(s).toContain('ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek/deepseek-v4.1-flash')
  expect(s).toContain('--permission-mode auto')
  // the user's own skills ride along, read-only
  expect(s).toContain('ln -sfn $HOME/.claude/skills $S/.claude/skills')
  expect(s).toContain('--add-dir $S --disallowedTools "Edit(/$S/**)" "Edit(/$HOME/.claude/skills/**)"')
  expect(s).toContain(`'fix the parser'\\''s bug; rm -rf /'`)
  expect(workerScript({ name: 'x', model: 'a/b', mode: 'auto', task: '', contextTokens: 1048576 })).toContain(
    'export CLAUDE_CODE_MAX_CONTEXT_TOKENS=1048576',
  )
  expect(s).not.toContain('CLAUDE_CODE_MAX_CONTEXT_TOKENS')
  expect(() => workerScript({ name: 'x', model: 'a/b;id', mode: 'auto', task: '' })).toThrow()
})

test('models: tool-capable only, cheapest first, searchable', () => {
  const json = JSON.stringify({
    data: [
      { id: 'google/gemini-x-flash', pricing: { prompt: '0.0000003', completion: '0.0000025' }, supported_parameters: ['tools'] },
      { id: 'deepseek/deepseek-v4.1-flash', context_length: 1048576, pricing: { prompt: '0.00000015', completion: '0.0000006' }, supported_parameters: ['tools', 'reasoning'] },
      { id: 'some/no-tools', pricing: { prompt: '0', completion: '0' }, supported_parameters: [] },
    ],
  })
  const models = parseModels(json)
  expect(models.map(m => m.id)).toEqual(['deepseek/deepseek-v4.1-flash', 'google/gemini-x-flash'])
  expect(models[0]?.inPerM.toFixed(2)).toBe('0.15')
  expect(models[0]?.contextTokens).toBe(1048576)
  expect(models[1]?.contextTokens).toBeUndefined()
  expect(search(models, 'flash gem').map(m => m.id)).toEqual(['google/gemini-x-flash'])
  expect(search(models, '')).toEqual([])
})

test('pins lead the list, search overrides it, retired only against a loaded catalog', () => {
  const models = [{ id: 'a/flash', inPerM: 0.1, outPerM: 0.2 }, { id: 'b/pro', inPerM: 1, outPerM: 2 }]
  expect(choicesFor(models, '', ['b/pro'], ['a/flash', 'b/pro'])).toEqual(['b/pro', 'a/flash'])
  expect(choicesFor(models, 'flash', ['b/pro'], [])).toEqual(['a/flash'])
  expect(isRetired(models, 'old/gone')).toBe(true)
  expect(isRetired(models, 'a/flash')).toBe(false)
  expect(isRetired([], 'old/gone')).toBe(false)
})

test('stored pins are sanitized', () => {
  expect(toPins(['a/b', 'bad; rm', 3, 'c/d:free'])).toEqual(['a/b', 'c/d:free'])
  expect(toPins(null)).toEqual([])
})

test('worker panes: labelled only', () => {
  expect(parsePanes('%3|cw-abc\n%4|\n%7|cw-003-tests\n\n')).toEqual([
    { pane: '%3', name: 'cw-abc' },
    { pane: '%7', name: 'cw-003-tests' },
  ])
})

test('peek skips the frame and keeps what the worker is doing', () => {
  const capture = [
    '⏺ Reading src/parser.rs',
    '✳ Churning… (12s · ↓ 1.2k tokens)',
    '─────────────────────────────',
    '❯ ',
    '─────────────────────────────',
    '  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt',
    '',
  ].join('\n')
  expect(peekLines(capture)).toEqual(['⏺ Reading src/parser.rs', '✳ Churning… (12s · ↓ 1.2k tokens)'])
  expect(peekLines('x'.repeat(100), 1, 10)).toEqual(['xxxxxxxxx…'])
})

test('peer messages: sender and body out of the envelope', () => {
  const env = '<cross-session-message from="uds:/tmp/cc-socks/4921.sock" from-name="cw-ping" from-mode="prompting">\npingpong ok 7341\n</cross-session-message>'
  expect(parsePeer(env)).toEqual({ from: 'cw-ping', body: 'pingpong ok 7341' })
  expect(parsePeer('plain text')).toEqual({ from: 'peer', body: 'plain text' })
})

test('lead name from ListAgents output', () => {
  expect(leadFrom('This session is Useful mods for workflows [141cc2] — the name other sessions use')).toBe('Useful mods for workflows')
  expect(leadFrom('something else')).toBeNull()
})

test('team preamble names teammates (not self) and the lead', () => {
  const s = teamPreamble({ name: 'cw-b', teammates: ['cw-a', 'cw-b'], lead: 'Useful mods for workflows' })
  expect(s).toContain('You are cw-b')
  expect(s).toContain('Teammates right now: cw-a.')
  expect(s).toContain('"Useful mods for workflows"')
  expect(teamPreamble({ name: 'cw-a', teammates: [], lead: null })).toContain('No teammates yet')
})

test('usage: each streamed message id counts once; context is the last prompt', () => {
  const a = (id: string, u: object) => JSON.stringify({ type: 'assistant', message: { id, usage: u } })
  const jsonl = [
    JSON.stringify({ type: 'agent-name', agentName: 'cw-ping' }),
    a('g1', { input_tokens: 35604, cache_read_input_tokens: 0, output_tokens: 36 }),
    a('g1', { input_tokens: 35604, cache_read_input_tokens: 0, output_tokens: 36 }),
    a('g2', { input_tokens: 508, cache_read_input_tokens: 35584, output_tokens: 110 }),
    'not json',
  ].join('\n')
  const u = usageFrom(jsonl)
  expect(u).toEqual({ input: 36112, cacheRead: 35584, cacheWrite: 0, output: 146, lastPrompt: 36092 })
  expect(tokensOf(u)).toBe(71842)
  const price = { id: 'deepseek/x', inPerM: 0.3, outPerM: 1.2, cachePerM: 0.03 }
  expect(costOf(u, price)?.toFixed(5)).toBe('0.01208') // 36112×0.3 + 35584×0.03 + 146×1.2 per M
  expect(costOf(u, undefined)).toBeNull()
})

test('formatting and folders', () => {
  expect(projectDir('/Users/ian', '/Users/ian/.claude/cw-pingpong')).toBe('/Users/ian/.claude/projects/-Users-ian--claude-cw-pingpong')
  expect([clockDur(27_000), clockDur(725_000), clockDur(3_729_000)]).toEqual(['0:27', '12:05', '1:02:09'])
  expect([kfmt(950), kfmt(38_400), kfmt(1_250_000)]).toEqual(['950', '38k', '1.3M'])
  expect(vendorOf('~deepseek/deepseek-flash-latest')).toBe('deepseek')
  expect(isWorking('✳ Churning… · esc to interrupt')).toBe(true)
})

test('pane metadata and banner model', () => {
  expect(parseMeta('%3\tcw-a\tgoogle/gemini-x\tauto\t1700\t/Users/ian/app\tfix\tthe parser\n%4\t\t\t\t\t\t\n')).toEqual([
    { pane: '%3', name: 'cw-a', model: 'google/gemini-x', mode: 'auto', start: 1700, cwd: '/Users/ian/app', task: 'fix\tthe parser' },
  ])
  expect(bannerModel(' ▝▜██████▀  deepseek/deepseek-v4.1-flash · API Usage Billing')).toBe('deepseek/deepseek-v4.1-flash')
  expect(bannerModel('no banner')).toBeNull()
})
