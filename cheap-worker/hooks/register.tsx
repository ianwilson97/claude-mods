import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Active, Launch, Mode, Msg, Picker, WStats } from '../types'
import { BEDROCK_MODELS, DEFAULT_MODEL, META_FORMAT, attachCommand, attachLine, defaultModelFor, ghosttyTabScript, herdrPaneId, surfaceRef, bannerModel, parseMeta, choicesFor, clockDur, costOf, isRetired, isWorking, kfmt, leadFrom, parseModels, parsePanes, parsePeer, peekLines, price, projectDir, search, sq, teamPreamble, toPins, tokensOf, usageFrom, vendorOf, workerScript } from './worker'
import type { LaunchMode, Provider } from './worker'

const PANE = 'cheap-worker'
const VIEW = 'cheap-workers'
const FORCE_AFTER_MS = 6000
const OR_LIME = '#c8f031'
const ACCENT = '#9fd17a'
// Permission mode as the card's colored word, like the screenshot's tier word.
const MODE_WORD: Record<Mode, string> = { acceptEdits: 'edits', auto: 'auto', default: 'ask' }
const MODE_COLOR: Record<Mode, string> = { acceptEdits: '#57ab5a', auto: '#539bf5', default: '#e0823d' }
// Provider logos as 16×16 pixel-art SVG traces (assets/providers-svg), for the remote surfaces' Svg; '' = none.
const iconsSvg = new Map<string, string>()
// 8×8 colour grids (assets/providers-px.json) drawn as half-block text: works in every
// terminal, including ones that can't show images (the desktop app's terminal prints alt text).
let pixels: Record<string, (string | null)[][]> | null = null
const MODES: readonly { value: Mode; label: string; note: string }[] = [
  { value: 'acceptEdits', label: 'edits', note: 'auto-approves file edits, asks for the rest' },
  { value: 'auto', label: 'auto', note: 'auto mode (under OpenRouter it may show a billing dialog once)' },
  { value: 'default', label: 'ask', note: 'asks before every edit and command' },
]

const DEFAULTS: Picker = {
  model: DEFAULT_MODEL,
  mode: 'acceptEdits',
  query: '',
  models: [],
  recent: [DEFAULT_MODEL],
  pins: [],
  launched: [],
  flash: null,
  active: [],
  closing: [],
  team: false,
  messages: [],
  stats: {},
  showFinished: true,
}
const MAX_MESSAGES = 40
// The plugin's userConfig (set per machine in /config): set by register, which reruns when it changes.
const cfg: { provider: Provider; launch: LaunchMode } = { provider: 'openrouter', launch: 'panes' }
const CREW_MARK = '# crew — cheap-worker'
// State outlives a reload, and the default above only seeds an empty slot: a
// value saved by an older version lacks newer fields until session.start fills them.
const picker = atom({ plugin: 'cheap-worker', key: 'picker' } as const, DEFAULTS)

async function loadModels($: EngineInterface): Promise<boolean> {
  if (cfg.provider === 'bedrock') {
    await update($, picker, p => ({ ...p, models: BEDROCK_MODELS }))
    return true
  }
  const res = await $.http.fetch('https://openrouter.ai/api/v1/models').catch(() => null)
  if (!res?.ok) return false
  const models = parseModels(res.text)
  await update($, picker, p => ({ ...p, models }))
  return true
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Cheap worker' })
  if ((await read($, picker)).models.length === 0) await loadModels($)
}

async function togglePin($: EngineInterface, id: string) {
  await update($, picker, p => ({ ...p, pins: p.pins.includes(id) ? p.pins.filter(x => x !== id) : [...p.pins, id] }))
  await $.store.set('pins', (await read($, picker)).pins)
}

async function tmux($: EngineInterface, args: string[]) {
  return $.process.run(['tmux', ...args])
}

async function launch($: EngineInterface, task: string): Promise<{ l: Launch; isTabOpen: boolean | null }> {
  const saved = await read($, picker)
  // a model the provider can't run (e.g. an OpenRouter pick, then switched to bedrock) → its default
  const isRunnable = cfg.provider === 'bedrock' ? BEDROCK_MODELS.some(m => m.id === saved.model) : !BEDROCK_MODELS.some(m => m.id === saved.model)
  const p = isRunnable ? saved : { ...saved, model: defaultModelFor(cfg.provider) }
  if (cfg.provider === 'openrouter') {
    const key = await $.process.run(['zsh', '-c', '[[ -n $CW_OPENROUTER_API_KEY ]]'])
    if (key.exitCode !== 0) throw new Error('CW_OPENROUTER_API_KEY is not set in ~/.zshenv')
  }

  const name = `cw-${(await $.clock.now()).toString(36).slice(-5)}`
  const prompt = p.team
    ? `${teamPreamble({ name, teammates: (p.active ?? []).map(a => a.name), lead: await leadName($) })}\n\nTask: ${task || 'wait for messages from teammates or the lead.'}`
    : task
  // Single-quoted whole, so only the pane's own zsh expands the key reference.
  const contextTokens = p.models.find(m => m.id === p.model)?.contextTokens
  const run = `zsh -c ${sq(workerScript({ name, model: p.model, mode: p.mode, task: prompt, contextTokens, provider: cfg.provider }))}`
  const cwd = await $.session.cwd()
  const fmt = ['-P', '-F', '#{pane_id}']

  const startedAt = await $.clock.now()
  const label = async (pane: string) => {
    await tmux($, ['set', '-p', '-t', pane, '@cw', name])
    // on the pane, so every session (not just this one) knows what this worker is
    for (const [k, v] of [['@cw_model', p.model], ['@cw_mode', p.mode], ['@cw_start', String(startedAt)], ['@cw_cwd', cwd], ['@cw_task', task.replace(/[\t\n]+/g, ' ').slice(0, 200)]] as const)
      await tmux($, ['set', '-p', '-t', pane, k, v])
  }
  const l: Launch = { name, model: p.model, mode: p.mode, pane: '', task, isLive: true, startedAt, cwd }

  if (cfg.launch === 'tabs') {
    // A tmux session of its own (it outlives a closed tab), shown in a new terminal tab.
    const made = await tmux($, ['new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', cwd, ...fmt, run])
    if (made.exitCode !== 0) throw new Error(made.stderr.trim() || 'tmux could not start a session')
    const pane = made.stdout.trim()
    await label(pane)
    const tmuxPath = (await $.process.run(['zsh', '-c', 'command -v tmux']).catch(() => null))?.stdout.trim() ?? ''
    return { l: { ...l, pane }, isTabOpen: tmuxPath.startsWith('/') && (await openTab($, name, tmuxPath)) }
  }

  // The same layout as cw: session `cw`, window `workers`, tiled panes.
  const hasSession = (await tmux($, ['has-session', '-t', 'cw'])).exitCode === 0
  const hasWindow = hasSession && (await tmux($, ['list-windows', '-t', 'cw', '-F', '#W'])).stdout.split('\n').includes('workers')
  const made = !hasSession
    ? await tmux($, ['new-session', '-d', '-s', 'cw', '-n', 'workers', '-x', '200', '-y', '50', '-c', cwd, ...fmt, run])
    : !hasWindow
      ? await tmux($, ['new-window', '-t', 'cw:', '-n', 'workers', '-c', cwd, ...fmt, run])
      : await tmux($, ['split-window', '-d', '-t', 'cw:workers', '-c', cwd, ...fmt, run])
  if (made.exitCode !== 0) throw new Error(made.stderr.trim() || 'tmux could not open a pane')
  const pane = made.stdout.trim()
  await tmux($, ['select-layout', '-t', 'cw:workers', 'tiled'])
  await label(pane)
  await tmux($, ['set', '-t', 'cw', 'pane-border-status', 'top'])
  await tmux($, ['set', '-t', 'cw', 'pane-border-format', ' #{@cw} '])
  return { l: { ...l, pane }, isTabOpen: null }
}

/**
 * Opens a background tab attached to the worker's session: in Herdr or cmux (when this session
 * runs inside one) through its CLI, else in Ghostty through AppleScript. False → the caller says CMD+T + crew.
 */
async function openTab($: EngineInterface, name: string, tmuxPath: string): Promise<boolean> {
  // Herdr first: it runs inside cmux or Ghostty, so when it's here it's the layer you're looking at.
  const herdrWs = await $.env.get('HERDR_WORKSPACE_ID').catch(() => undefined)
  if (herdrWs) {
    const herdr = (await $.env.get('HERDR_BIN_PATH').catch(() => undefined)) || 'herdr'
    const made = await $.process.run([herdr, 'tab', 'create', '--workspace', herdrWs, '--label', name], { timeoutMs: 10_000 }).catch(() => null)
    const pane = made?.exitCode === 0 ? herdrPaneId(made.stdout) : null
    if (!pane) return false
    const ran = await $.process.run([herdr, 'pane', 'run', pane, attachCommand(name, tmuxPath)], { timeoutMs: 10_000 }).catch(() => null)
    return ran?.exitCode === 0
  }
  if (await $.env.get('CMUX_WORKSPACE_ID').catch(() => undefined)) {
    const cmux = (await $.env.get('CMUX_BUNDLED_CLI_PATH').catch(() => undefined)) || 'cmux'
    const made = await $.process.run([cmux, 'new-surface', '--type', 'terminal', '--focus', 'false'], { timeoutMs: 10_000 }).catch(() => null)
    const ref = made?.exitCode === 0 ? surfaceRef(made.stdout) : null
    if (!ref) return false
    await $.process.run([cmux, 'rename-tab', '--surface', ref, name], { timeoutMs: 10_000 }).catch(() => null)
    const sent = await $.process.run([cmux, 'send', '--surface', ref, attachLine(name, tmuxPath)], { timeoutMs: 10_000 }).catch(() => null)
    return sent?.exitCode === 0
  }
  // The first run waits on macOS's "allow control of Ghostty?" dialog; past 15s (or refused) → manual CMD+T + crew.
  const tab = await $.process.run(['osascript', '-e', ghosttyTabScript(name, tmuxPath)], { timeoutMs: 15_000 }).catch(() => null)
  return tab?.exitCode === 0
}

/** Puts the `crew` picker on PATH (~/.local/bin), never over someone else's `crew`. */
async function installCrew($: EngineInterface) {
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const src = await $.fs.read(`${$.plugin.root}/bin/crew`).catch(() => null)
  if (!home || typeof src !== 'string') return
  const dest = `${home}/.local/bin/crew`
  const cur = await $.fs.read(dest).catch(() => null)
  if (cur === src || (typeof cur === 'string' && !cur.includes(CREW_MARK))) return
  await $.process.run(['mkdir', '-p', `${home}/.local/bin`])
  await $.fs.write(dest, src)
  await $.process.run(['chmod', '+x', dest])
}

// This session's name as other sessions address it, from the ListAgents tool.
async function leadName($: EngineInterface): Promise<string | null> {
  const res = await $.tool.call({ tool: 'ListAgents' } as never).catch(() => null)
  const r = res as { result?: unknown } | null
  const text = typeof r?.result === 'string' ? r.result : JSON.stringify(r?.result ?? '')
  return leadFrom(text)
}

async function logMessage($: EngineInterface, m: Msg) {
  await update($, picker, x => ({ ...x, messages: [...(x.messages ?? []), m].slice(-MAX_MESSAGES) }))
}

async function sendTo($: EngineInterface, to: string, text: string) {
  const res = await $.session.send({ to, text }).catch(err => ({ isDelivered: false as const, reason: String(err) }))
  await logMessage($, { dir: 'out', peer: to, text, at: await $.clock.now(), ...(res.isDelivered ? {} : { isFailed: true }) })
  if (!res.isDelivered) $.ui.toast(`Not delivered to ${to}: ${res.reason}`)
}

// tmux is the source of truth: every labelled pane on the server (session `cw`'s
// tiles and tabs-mode sessions `cw-*` alike), this mod's
// workers and driver-seat's alike, each with a peek at its last output lines.
async function refreshLive($: EngineInterface) {
  const res = await tmux($, ['list-panes', '-a', '-F', META_FORMAT]).catch(() => null)
  const panes = res?.exitCode === 0 ? parseMeta(res.stdout) : []
  // Workers another session launched (or launched before pane metadata existed): learn the
  // model from the startup banner once, save it on the pane, and adopt them here.
  const known = new Set((await read($, picker)).launched.map(l => l.pane))
  const adopted: Launch[] = []
  for (const m of panes) {
    if (known.has(m.pane)) continue
    let model = m.model
    if (!model) {
      const full = (await tmux($, ['capture-pane', '-p', '-J', '-S', '-', '-t', m.pane]).catch(() => null))?.stdout ?? ''
      model = bannerModel(full) ?? ''
      if (model) await tmux($, ['set', '-p', '-t', m.pane, '@cw_model', model])
    }
    if (!model) continue // not a cheap worker we can describe (e.g. driver-seat's): stays external
    const mode = (['acceptEdits', 'auto', 'default'] as const).find(x => x === m.mode) ?? 'acceptEdits'
    adopted.push({ name: m.name, model, mode, pane: m.pane, task: m.task, isLive: true, ...(m.start ? { startedAt: m.start } : {}), ...(m.cwd ? { cwd: m.cwd } : {}) })
  }
  if (adopted.length > 0) await update($, picker, x => ({ ...x, launched: [...adopted, ...x.launched].slice(0, 24) }))
  const p = await read($, picker)
  const active: Active[] = []
  for (const { pane, name } of panes) {
    const cap = (await tmux($, ['capture-pane', '-p', '-J', '-t', pane]).catch(() => null))?.stdout ?? ''
    active.push({
      pane,
      name,
      launch: p.launched.find(l => l.pane === pane) ?? null,
      peek: peekLines(cap),
      isClosing: p.closing.includes(pane),
      isBusy: isWorking(cap),
    })
  }
  const live = new Set(panes.map(x => x.pane))
  const now = await $.clock.now()
  await update($, picker, x => ({
    ...x,
    active,
    closing: x.closing.filter(c => live.has(c)),
    launched: x.launched.map(l => {
      const isLive = live.has(l.pane)
      return { ...l, isLive, ...(!isLive && l.endedAt === undefined ? { endedAt: now } : {}) }
    }),
  }))
  await refreshStats($)
  $.ui.status(active.length > 0 ? `workers: ${active.length} running` : undefined)
}

// Tokens, ≈cost and context fill, read from each worker's own transcript: live
// workers every refresh, a finished one once more after it ends.
async function refreshStats($: EngineInterface) {
  const p = await read($, picker)
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const now = await $.clock.now()
  const next: Record<string, WStats> = { ...(p.stats ?? {}) }
  const found: Record<string, string> = {}
  for (const l of p.launched) {
    // a finished worker gets 15s more of reads, so its last reply is counted
    const isSettled = !l.isLive && now - (l.endedAt ?? now) > 15_000 && next[l.name] !== undefined
    if (isSettled || !l.cwd || !home) continue
    let file = l.transcript
    if (!file) {
      const dir = projectDir(home, l.cwd)
      const hit = await $.process.run(['grep', '-rl', '--include=*.jsonl', '-e', `"agentName":"${l.name}"`, dir]).catch(() => null)
      file = hit?.stdout.split('\n').find(Boolean)
      if (!file) continue
      found[l.name] = file
    }
    const text = await $.fs.read(file).catch(() => null)
    if (typeof text !== 'string') continue
    const u = usageFrom(text)
    const model = p.models.find(m => m.id === l.model)
    next[l.name] = {
      tokens: tokensOf(u),
      cost: costOf(u, model),
      ctxPct: model?.contextTokens ? Math.round((100 * u.lastPrompt) / model.contextTokens) : null,
    }
  }
  await update($, picker, x => ({
    ...x,
    stats: next,
    launched: x.launched.map(l => (found[l.name] ? { ...l, transcript: found[l.name] } : l)),
  }))
}

// Asks the worker to /exit (its transcript closes cleanly), then kills the pane
// if it's still there: a worker mid-turn only reads /exit once the turn ends.
async function closeWorker($: EngineInterface, pane: string) {
  await update($, picker, x => ({ ...x, closing: [...x.closing.filter(c => c !== pane), pane] }))
  await tmux($, ['send-keys', '-t', pane, 'C-u'])
  await tmux($, ['send-keys', '-t', pane, '-l', '/exit'])
  await tmux($, ['send-keys', '-t', pane, 'Enter'])
  await refreshLive($)
  $.clock.after(FORCE_AFTER_MS, async () => {
    const still = (await tmux($, ['list-panes', '-a', '-F', '#{pane_id}'])).stdout.split('\n').includes(pane)
    if (still) {
      // claude survives the hangup kill-pane sends, so stop its process first
      // (the pane exec'd into claude: the pane's pid is the worker's).
      const pid = (await tmux($, ['display-message', '-p', '-t', pane, '#{pane_pid}'])).stdout.trim()
      if (/^\d+$/.test(pid)) await $.process.run(['kill', pid])
      await tmux($, ['kill-pane', '-t', pane])
    }
    await refreshLive($)
  })
}

async function openView($: EngineInterface) {
  await refreshLive($)
  await $.ui.open({ id: VIEW, title: 'Workers' })
}

export const register: Register = (on, options) => {
  const o = (options ?? {}) as { provider?: unknown; launch?: unknown }
  cfg.provider = o.provider === 'bedrock' ? 'bedrock' : 'openrouter'
  cfg.launch = o.launch === 'tabs' ? 'tabs' : 'panes'

  on('session.start', async ($, e, next) => {
    const via = cfg.provider === 'bedrock' ? 'Bedrock Claude' : 'cheap OpenRouter'
    await $.command.register({ name: 'worker', description: `Spin up a ${via} worker (${cfg.launch === 'tabs' ? 'opens a terminal tab' : 'tmux pane'})` })
    await $.command.register({ name: 'workers', description: 'See and close the active workers' })
    const pins = toPins(await $.store.get('pins').catch(() => null))
    await update($, picker, p => {
      const base = { ...DEFAULTS, ...p, pins, model: pins[0] ?? p.model ?? DEFAULTS.model }
      // switching provider: a model the other provider can't run falls back to its default
      if (cfg.provider === 'bedrock')
        return { ...base, models: BEDROCK_MODELS, model: BEDROCK_MODELS.some(m => m.id === base.model) ? base.model : defaultModelFor('bedrock') }
      return BEDROCK_MODELS.some(m => m.id === base.model) ? { ...base, models: [], model: DEFAULT_MODEL } : base
    })
    void installCrew($)
    // ponytail: polls tmux; one list-panes plus a capture per worker, fine for a handful
    $.clock.every(5000, () => refreshLive($))
    return next(e)
  })

  on('command.run', { command: 'worker' }, async $ => {
    await openPane($)
    return { text: 'Cheap worker pane open.' }
  })

  // Messages other sessions send here: logged for the Workers view and toasted,
  // then passed on untouched so the model still reads them.
  on('session.receive', async ($, e, next) => {
    const kind = (e.origin as { kind: string }).kind
    if (e.agentId === undefined && (kind === 'peer' || kind === 'peer-send-message')) {
      const { from, body } = parsePeer(e.text)
      await logMessage($, { dir: 'in', peer: from, text: body, at: await $.clock.now() })
      $.ui.toast(`✉ ${from}: ${body.length > 60 ? `${body.slice(0, 59)}…` : body}`)
    }
    return next(e)
  })

  on('command.run', { command: 'workers' }, async $ => {
    await openView($)
    return { text: 'Workers view open.' }
  })

  // Footer button, bottom right beside quick-settings' ⚙: the OpenRouter mark
  // (Ghostty/kitty draw it; elsewhere a lime dot) and a live worker count.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const below = await next(e)
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const running = (await read($, picker)).active?.length ?? 0
    if (Svg && !iconsSvg.has('openrouter')) {
      const svg = await $.fs.read(`${$.plugin.root}/assets/providers-svg/openrouter.svg`).catch(() => null)
      iconsSvg.set('openrouter', typeof svg === 'string' ? svg : '')
    }
    const orSvg = iconsSvg.get('openrouter')
    const mark =
      cfg.provider === 'bedrock' ? (
        <Text color="#d97757">✻</Text>
      ) : Svg && orSvg ? (
        <Svg key="or-mark" source={orSvg} width={14} height={14} alt="OpenRouter" />
      ) : (
        <Text color={OR_LIME}>◉</Text>
      )
    return (
      <Box justifyContent="space-between">
        <Box flexGrow={1}>{below}</Box>
        <Box key="worker-chip" columnGap={1} marginLeft={2}>
          {mark}
          <Button key="worker-open" plain label="worker" hover={{ color: OR_LIME, bold: true }} onPress={() => openPane($)} />
          {running > 0 && (
            <Button key="workers-view" plain label={`· ${running} live`} hover={{ color: OR_LIME, bold: true }} onPress={() => openView($)} />
          )}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    // mobile draws no Input: text boxes are left out there
    const Input = 'Input' in els ? els.Input : null
    const p = await read($, picker)
    const info = (id: string) => p.models.find(m => m.id === id)
    const isBedrock = cfg.provider === 'bedrock'
    const priceOf = (id: string) => (isBedrock ? 'via Amazon Bedrock' : price(info(id)))
    const matches = search(p.models, p.query)
    const choices =
      cfg.provider === 'bedrock' ? BEDROCK_MODELS.map(m => m.id) : choicesFor(p.models, p.query, p.pins, p.recent)
    const choose = (id: string) =>
      update($, picker, x => ({ ...x, model: id, recent: [id, ...x.recent.filter(r => r !== id)].slice(0, 4) }))

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="column">
          <Text bold color={ACCENT}>Model</Text>
          <Box justifyContent="space-between">
            <Text>
              <Text bold>{p.model}</Text>
              <Text dimColor>  {priceOf(p.model)}</Text>
              {isRetired(p.models, p.model) && <Text color="#e5534b">  not in catalog: retired?</Text>}
            </Text>
            {!isBedrock && <Button
              key="refresh"
              plain
              dimColor
              label={`↻ refresh${p.models.length > 0 ? ` (${p.models.length})` : ''}`}
              onPress={async () => {
                const ok = await loadModels($)
                const n = (await read($, picker)).models.length
                await update($, picker, x => ({
                  ...x,
                  flash: ok ? { text: `Catalog refreshed: ${n} tool-capable models.`, isError: false } : { text: 'OpenRouter unreachable; kept the old list.', isError: true },
                }))
              }}
            />}
          </Box>
          {Input && !isBedrock && (
          <Input
            key="query"
            placeholder={p.models.length > 0 ? `search ${p.models.length} tool-capable models…` : 'loading models… (or type a slug, Enter)'}
            value={p.query}
            onInput={(value: string) => update($, picker, x => ({ ...x, query: value }))}
            onSubmit={(value: string) => (matches[0] ? choose(matches[0].id) : choose(value.trim()))}
          />
          )}
          <Box flexDirection="column">
            {choices.map(id => (
              <Box key={`row-${id}`} columnGap={1}>
                <Button key={`pin-${id}`} plain label={p.pins.includes(id) ? '★' : '☆'} onPress={() => togglePin($, id)} />
                <Button
                  key={`m-${id}`}
                  plain
                  dimColor={id !== p.model}
                  label={`${id === p.model ? '●' : '○'} ${id}  ${isRetired(p.models, id) ? '✗ retired?' : priceOf(id)}`}
                  onPress={() => choose(id)}
                />
              </Box>
            ))}
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text bold color={ACCENT}>Permissions</Text>
          <Box columnGap={1}>
            {MODES.map(m => (
              <Button
                key={`mode-${m.value}`}
                label={`${m.value === p.mode ? '●' : '○'} ${m.label}`}
                variant={m.value === p.mode ? 'primary' : 'secondary'}
                onPress={() => update($, picker, x => ({ ...x, mode: m.value }))}
              />
            ))}
          </Box>
          <Text dimColor>{MODES.find(m => m.value === p.mode)?.note}</Text>
        </Box>

        <Box flexDirection="column">
          <Text bold color={ACCENT}>Team</Text>
          <Box columnGap={1}>
            <Button
              key="team-toggle"
              label={p.team ? '● team' : '○ solo'}
              variant={p.team ? 'primary' : 'secondary'}
              onPress={() => update($, picker, x => ({ ...x, team: !x.team }))}
            />
          </Box>
          <Text dimColor>
            {p.team
              ? `knows its teammates${(p.active ?? []).length > 0 ? ` (${p.active.map(a => a.name).join(', ')})` : ''} and reports to this session via SendMessage`
              : 'works alone; you can still message it from the Workers view'}
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text bold color={ACCENT}>Task</Text>
          {Input && (
          <Input
            key="task"
            placeholder="what should the worker do? (Enter launches; empty opens it idle)"
            submitLabel="Launch"
            onSubmit={async (value: string) => {
              try {
                const { l, isTabOpen } = await launch($, value.trim())
                const where =
                  isTabOpen === null
                    ? `${l.name} started in tmux cw:workers. Watch: tmux new -A -s cw`
                    : isTabOpen
                      ? `${l.name} opened in a new tab (or: crew ${l.name.slice(3)})`
                      : `${l.name} is running. Open it: CMD+T, then  crew ${l.name.slice(3)}`
                await update($, picker, x => ({ ...x, launched: [l, ...x.launched].slice(0, 12), flash: { text: where, isError: false } }))
                if (isTabOpen === false) $.ui.toast(`${l.name}: CMD+T, then  crew ${l.name.slice(3)}`)
              } catch (err) {
                const text = err instanceof Error ? err.message : String(err)
                await update($, picker, x => ({ ...x, flash: { text, isError: true } }))
              }
            }}
          />
          )}
        </Box>

        {p.flash && <Text color={p.flash.isError ? '#e5534b' : '#57ab5a'}>{p.flash.isError ? '✗' : '✓'} {p.flash.text}</Text>}

        <Box key="to-view">
          <Button
            key="open-view"
            plain
            dimColor={p.active.length === 0}
            label={p.active.length > 0 ? `◉ ${p.active.length} live worker${p.active.length > 1 ? 's' : ''} · view & close →` : '○ no live workers · view →'}
            hover={{ color: OR_LIME, bold: true }}
            onPress={() => openView($)}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: VIEW }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Input = 'Input' in els ? els.Input : null
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const p = await read($, picker)
    const now = await $.clock.now()
    const stats = p.stats ?? {}
    if (pixels === null) {
      const raw = await $.fs.read(`${$.plugin.root}/assets/providers-px.json`).catch(() => null)
      try {
        pixels = typeof raw === 'string' ? JSON.parse(raw) : {}
      } catch {
        pixels = {}
      }
    }
    const hhmm = (t: number) => {
      const d = new Date(t)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    // Provider marks, read once per load ('' = no logo shipped: letter badge).
    const vendors = new Set([...(p.active ?? []), ...p.launched].map(w => vendorOf(('launch' in w ? w.launch?.model : w.model) ?? '')))
    for (const v of vendors) {
      if (v && Svg && !iconsSvg.has(v)) {
        const svg = await $.fs.read(`${$.plugin.root}/assets/providers-svg/${v}.svg`).catch(() => null)
        iconsSvg.set(v, typeof svg === 'string' ? svg : '')
      }
    }

    const running = p.active ?? []
    const finished = p.launched.filter(l => !l.isLive)
    const all = [...running.map(w => w.launch).filter((l): l is Launch => l !== null), ...finished]
    const totals = all.reduce(
      (t, l) => {
        const s = stats[l.name]
        return { cost: t.cost + (s?.cost ?? 0), tokens: t.tokens + (s?.tokens ?? 0) }
      },
      { cost: 0, tokens: 0 },
    )
    const firstStart = Math.min(...all.map(l => l.startedAt ?? now), now)
    const lastEnd = running.length > 0 ? now : Math.max(...finished.map(l => l.endedAt ?? now), firstStart)

    const avatar = (model: string, key: string) => {
      const v = vendorOf(model)
      const svg = iconsSvg.get(v)
      const grid = e.surface === 'terminal' ? pixels?.[v] : undefined
      return grid ? (
        <Box key={`av-${key}`} flexDirection="column" width={8}>
          {[0, 2, 4, 6].map(y => (
            <Text key={`av-${key}-${y}`}>
              {grid[y]!.map((top, x) => {
                const bot = grid[y + 1]![x] ?? null
                return top && bot ? (
                  <Text key={`px-${x}`} color={top} backgroundColor={bot}>▀</Text>
                ) : top ? (
                  <Text key={`px-${x}`} color={top}>▀</Text>
                ) : bot ? (
                  <Text key={`px-${x}`} color={bot}>▄</Text>
                ) : (
                  ' '
                )
              })}
            </Text>
          ))}
        </Box>
      ) : Svg && svg ? (
        <Svg key={`av-${key}`} source={svg} width={32} height={32} alt={`${v} logo`} />
      ) : (
        <Box key={`av-${key}`} width={8} height={4} justifyContent="center" alignItems="center" backgroundColor="#2d333b">
          <Text bold color={OR_LIME}>{(v || '?').slice(0, 1).toUpperCase()}</Text>
        </Box>
      )
    }
    const tile = (label: string, value: string) => (
      <Box key={`tile-${label}`} flexDirection="column" flexGrow={1} borderStyle="round" borderColor="#3b3f4a" paddingX={1}>
        <Text dimColor>{label}</Text>
        <Text bold>{value}</Text>
      </Box>
    )
    const bar = (pct: number, color: string, width = 34) => {
      const fill = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
      return (
        <Text>
          <Text color={color}>{'━'.repeat(fill)}</Text>
          <Text color="#3b3f4a">{'━'.repeat(width - fill)}</Text>
        </Text>
      )
    }
    const statLine = (l: Launch | null, end: number) => {
      const s = l ? stats[l.name] : undefined
      const parts = [
        s?.ctxPct != null ? `ctx ${s.ctxPct}%` : null,
        s ? kfmt(s.tokens) : null,
        s?.cost != null ? `≈$${s.cost.toFixed(2)}` : null,
        l?.startedAt ? clockDur(end - l.startedAt) : null,
      ].filter(Boolean)
      return parts.join(' · ')
    }
    const title = (l: Launch | null, name: string) => {
      const t = l?.task?.split('\n')[0]?.trim()
      return t ? (t.length > 48 ? `${t.slice(0, 47)}…` : t) : name
    }
    const subtitle = (l: Launch | null, name: string) =>
      l ? (
        <Text>
          <Text color={MODE_COLOR[l.mode]}>{MODE_WORD[l.mode]}</Text>
          <Text dimColor> {l.model.split('/')[1] ?? l.model} · {name}</Text>
        </Text>
      ) : (
        <Text dimColor>{name} · driver-seat / external</Text>
      )

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold>Workers</Text>
          <Button key="view-refresh" plain dimColor label="↻" onPress={() => refreshLive($)} />
        </Box>

        <Box columnGap={1}>
          {tile('Cost', all.length > 0 ? `≈$${totals.cost.toFixed(2)}` : '—')}
          {tile('Tokens', all.length > 0 ? kfmt(totals.tokens) : '—')}
          {tile('Time', all.length > 0 ? clockDur(lastEnd - firstStart) : '—')}
        </Box>

        <Box flexDirection="column">
          <Text dimColor>Running · {running.length}</Text>
          {running.length === 0 && <Text dimColor>  none. Launch one from the worker button.</Text>}
          {running.map(w => {
            const color = w.launch ? MODE_COLOR[w.launch.mode] : OR_LIME
            const s = w.launch ? stats[w.launch.name] : undefined
            return (
              <Box key={`card-${w.pane}`} flexDirection="column" paddingY={0} marginTop={1}>
                <Box columnGap={2}>
                  {avatar(w.launch?.model ?? '', w.pane)}
                  <Box flexDirection="column" flexGrow={1}>
                    <Box justifyContent="space-between">
                      <Text bold>{title(w.launch, w.name)}</Text>
                      <Text color={w.isClosing ? '#e8c46a' : w.isBusy ? '#57ab5a' : '#768390'}>
                        {w.isClosing ? '◌ closing' : w.isBusy ? '●' : '◌ idle'}
                      </Text>
                    </Box>
                    {subtitle(w.launch, w.name)}
                    <Box justifyContent="space-between">
                      <Text dimColor>{w.peek.at(-1)?.slice(0, 40) ?? 'starting…'}</Text>
                      <Text dimColor>{statLine(w.launch, now)}</Text>
                    </Box>
                    {bar(s?.ctxPct ?? 0, color)}
                  </Box>
                </Box>
                <Box columnGap={2} marginLeft={6}>
                  {Input && !w.isClosing && (
                    <Input
                      key={`msg-${w.pane}`}
                      placeholder={`message ${w.name}…`}
                      submitLabel="Send"
                      onSubmit={(value: string) => (value.trim() ? sendTo($, w.name, value.trim()) : undefined)}
                    />
                  )}
                  {!w.isClosing && (
                    <Button
                      key={`close-${w.pane}`}
                      plain
                      dimColor
                      label="✕ close"
                      hover={{ color: '#e5534b', bold: true }}
                      onPress={() => closeWorker($, w.pane)}
                    />
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>

        {finished.length > 0 && (
          <Box flexDirection="column">
            <Box key="finished-head">
              <Button
                key="toggle-finished"
                plain
                dimColor
                label={`${p.showFinished ? '▾' : '▸'} Finished · ${finished.length}`}
                onPress={() => update($, picker, x => ({ ...x, showFinished: !x.showFinished }))}
              />
            </Box>
            {p.showFinished &&
              finished.map(l => (
                <Box key={`done-${l.name}`} columnGap={2} marginTop={1}>
                  {avatar(l.model, `done-${l.name}`)}
                  <Box flexDirection="column" flexGrow={1}>
                    <Box justifyContent="space-between">
                      <Text bold>{title(l, l.name)}</Text>
                      <Text color="#57ab5a">✓</Text>
                    </Box>
                    {subtitle(l, l.name)}
                    <Box justifyContent="flex-end">
                      <Text dimColor>{statLine(l, l.endedAt ?? now)}</Text>
                    </Box>
                    {bar(100, MODE_COLOR[l.mode])}
                  </Box>
                </Box>
              ))}
          </Box>
        )}

        {(p.messages ?? []).length > 0 && (
          <Box flexDirection="column">
            <Box justifyContent="space-between">
              <Text dimColor>Messages · {(p.messages ?? []).length}</Text>
              <Button key="msgs-clear" plain dimColor label="clear" onPress={() => update($, picker, x => ({ ...x, messages: [] }))} />
            </Box>
            {(p.messages ?? []).slice(-8).map((m, i) => (
              <Text key={`m-${i}-${m.at}`} dimColor={m.dir === 'out'}>
                <Text color={m.isFailed ? '#e5534b' : m.dir === 'in' ? OR_LIME : undefined}>{m.dir === 'in' ? '←' : m.isFailed ? '✗' : '→'}</Text>
                {` ${hhmm(m.at)} ${m.peer}: ${m.text.length > 90 ? `${m.text.slice(0, 89)}…` : m.text}`}
              </Text>
            ))}
          </Box>
        )}

        <Text dimColor>watch live: tmux new -A -s cw · ✕ sends /exit, force-closes after {FORCE_AFTER_MS / 1000}s</Text>
      </Box>
    )
  })
}
