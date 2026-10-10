import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Board, Kind, Track } from '../types'
import {
  FRAME_MS, KEEP_MS, META_FORMAT, SLIDE_MS, STALL_MS, TASK_TOOLS, TONE, TRACK,
  applyTask, barOf, clockDur, encode, fillAt, frame, fromTranscript, hex, isMoving, parseMeta, projectDir, summary, svgBar, textBar, vendorOf,
} from './progress'

const PANE = 'agent-progress'
const W = 24 // bar width in terminal cells
const MODE_WORD: Record<string, string> = { acceptEdits: 'edits', auto: 'auto', default: 'ask' }
const MODE_COLOR: Record<string, string> = { acceptEdits: '#57ab5a', auto: '#539bf5', default: '#e0823d' }
const NUDGE =
  'When a request takes three or more distinct steps, keep a task list (TaskCreate/TaskUpdate, or TodoWrite): ' +
  'mark each step in_progress as you start it and completed as soon as it is done. The user watches a progress bar built from it.'

const DEFAULTS: Board = { tracks: [], isNudgeOn: true, isMotionOn: true, view: 'all' }
const board = atom({ plugin: 'agent-progress', key: 'board' } as const, DEFAULTS)

// Module-local (not $.state): timers and caches start over on reload, which is fine.
let frameTimer: Timer | null = null
let isPaneOpen = false
const denied = new Set<string>() // Raster keys whose blit was refused: static until the pane reopens
const transcripts = new Map<string, string>()
const svgs = new Map<string, string>()
let pixels: Record<string, (string | null)[][]> | null = null

const blank = (id: string, kind: Kind, name: string, now: number): Track => ({
  id, kind, name, model: '', mode: '', items: [], steps: 0, startedAt: now, updatedAt: now,
  endedAt: null, outcome: null, isBusy: kind !== 'main', from: 0, changedAt: 0,
})
const fractionOf = (t: Track) => barOf(t, 0, true).to ?? 0

/**
 * Rewrites one track (creating it when `fn` gets undefined); null leaves the board alone.
 * When the bar's fraction moves, stamps where it slid from and when, then starts the frame clock.
 */
async function change($: EngineInterface, id: string, fn: (t: Track | undefined, now: number) => Track | null) {
  const now = await $.clock.now()
  const b = await read($, board)
  const old = b.tracks.find(t => t.id === id)
  const nxt = fn(old, now)
  if (!nxt || (old && JSON.stringify(old) === JSON.stringify(nxt))) return
  const before = old ? fractionOf(old) : 0
  const moved = fractionOf(nxt) !== before
  const t = moved ? { ...nxt, from: before, changedAt: now } : nxt
  await update($, board, x => ({ ...x, tracks: x.tracks.some(y => y.id === id) ? x.tracks.map(y => (y.id === id ? t : y)) : [...x.tracks, t] }))
  if (moved || t.isBusy) kick($)
}

/** Starts the ~30fps frame clock unless it's running or motion is off. */
function kick($: EngineInterface) {
  if (frameTimer) return
  frameTimer = $.clock.every(FRAME_MS, () => void tick($))
}

/** One frame: blit the pane's moving bars, redraw the footer while it slides, stop when all is still. */
async function tick($: EngineInterface) {
  const b = await read($, board)
  const now = await $.clock.now()
  const isFooterSliding = b.isMotionOn && b.tracks.some(t => now - t.changedAt < SLIDE_MS)
  let isBlitting = false
  if (isPaneOpen && b.isMotionOn) {
    for (const t of b.tracks) {
      const key = `bar-${t.id}`
      const bar = barOf(t, now, true)
      if (denied.has(key) || !isMoving(bar, now) || (t.endedAt !== null && now - t.endedAt > KEEP_MS)) continue
      const r = await $.ui.blit({ requestId: PANE, key, cells: encode(frame(bar, now, W)) }).catch(() => ({ deny: 'threw' }))
      if ('deny' in r) denied.add(key)
      else isBlitting = true
    }
  }
  if (isFooterSliding) $.ui.invalidate('ui.render')
  if (!isFooterSliding && !isBlitting) {
    frameTimer?.cancel()
    frameTimer = null
  }
}

async function openPane($: EngineInterface, view?: Board['view']) {
  if (view) await update($, board, b => ({ ...b, view }))
  isPaneOpen = true
  denied.clear()
  await $.ui.open({ id: PANE, title: 'Agent progress' })
  void refresh($)
  kick($)
}

async function run($: EngineInterface, argv: string[]) {
  const r = await $.process.run(argv).catch(() => null)
  return r?.exitCode === 0 ? r.stdout : ''
}

/** Every 5s: subagents from $.agent.list, workers from tmux + the tail of their transcripts. */
async function refresh($: EngineInterface) {
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  if (pixels === null && home) {
    const raw = await $.fs.read(`${$.plugin.root}/assets/providers-px.json`).catch(() => null)
    try {
      pixels = typeof raw === 'string' ? JSON.parse(raw) : {}
    } catch {
      pixels = {}
    }
  }

  const agents = await $.agent.list().catch(() => [])
  const seen = new Set<string>()
  for (const a of agents) {
    const id = `s:${a.id}`
    seen.add(id)
    const isEnded = a.status === 'completed' || a.status === 'failed' || a.status === 'killed'
    await change($, id, (t, now) => {
      if (t?.endedAt != null) return null
      const base = t ?? blank(id, 'sub', a.description || a.name || a.type, now)
      return {
        ...base,
        name: a.description || a.name || a.type,
        model: a.type,
        isBusy: !isEnded && a.status !== 'idle',
        ...(isEnded && { endedAt: now, outcome: a.status === 'completed' ? ('done' as const) : ('failed' as const) }),
      }
    })
  }

  const panes = parseMeta(await run($, ['tmux', 'list-panes', '-a', '-F', META_FORMAT]))
  for (const p of panes) {
    const id = `w:${p.name}`
    seen.add(id)
    let file = transcripts.get(p.name)
    if (!file && home && p.cwd) {
      const hit = await run($, ['grep', '-rl', '--include=*.jsonl', '-e', `"agentName":"${p.name}"`, projectDir(home, p.cwd)])
      file = hit.split('\n').find(Boolean)
      if (file) transcripts.set(p.name, file)
    }
    // ponytail: last 2MB only; a TaskCreate older than that is lost (its updates then ignored)
    const r = fromTranscript(file ? await run($, ['tail', '-c', '2000000', file]) : '')
    await change($, id, (t, now) => ({
      ...(t ?? blank(id, 'worker', p.name, p.start ?? now)),
      model: p.model,
      mode: p.mode,
      items: r.items,
      steps: r.steps,
      updatedAt: r.lastAt ?? t?.updatedAt ?? now,
      isBusy: true,
      endedAt: null,
      outcome: null,
    }))
  }

  // Gone from both lists: finished. Then drop what finished over 10 minutes ago.
  const now = await $.clock.now()
  for (const t of (await read($, board)).tracks) {
    if (t.kind !== 'main' && t.endedAt === null && !seen.has(t.id)) await change($, t.id, x => (x ? { ...x, endedAt: now, outcome: 'done', isBusy: false } : null))
  }
  const b = await read($, board)
  if (b.tracks.some(t => t.endedAt !== null && now - t.endedAt > KEEP_MS))
    await update($, board, x => ({ ...x, tracks: x.tracks.filter(t => t.endedAt === null || now - t.endedAt <= KEEP_MS) }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progress', description: 'Agent progress bars: /progress [workers|all] · motion on|off · nudge on|off' })
    const motion = await $.store.get('motion').catch(() => undefined)
    const nudge = await $.store.get('nudge').catch(() => undefined)
    await update($, board, b => ({
      ...DEFAULTS,
      ...b,
      ...(typeof motion === 'boolean' && { isMotionOn: motion }),
      ...(typeof nudge === 'boolean' && { isNudgeOn: nudge }),
    }))
    $.clock.every(5000, () => void refresh($))
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    const [word, arg] = e.args.trim().split(/\s+/)
    if (word === 'motion' || word === 'nudge') {
      const isOn = arg !== 'off'
      await $.store.set(word, isOn)
      await update($, board, b => ({ ...b, ...(word === 'motion' ? { isMotionOn: isOn } : { isNudgeOn: isOn }) }))
      return { text: `agent-progress: ${word} ${isOn ? 'on' : 'off'}` }
    }
    await openPane($, word === 'workers' ? 'workers' : 'all')
    return { text: 'Agent progress open.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isPaneOpen = false
    return next(e)
  }).catch(($, e, next) => next(e)) // progress is cosmetic: fail open

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, board)).isNudgeOn) return composed
    return { sections: [...composed.sections, { id: 'agent-progress:tasks', text: NUDGE, scope: 'session' as const }] }
  })

  // The main agent: busy from the prompt to the turn's end; a finished list clears for the next one.
  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    await change($, 'main', (t, now) => {
      const base = t ?? blank('main', 'main', 'Claude', now)
      const { done, total } = summary(base.items)
      const isFresh = total === 0 || done === total
      return { ...base, isBusy: true, updatedAt: now, ...(isFresh && { items: [], steps: 0, startedAt: now }) }
    })
    return r
  }).catch(($, e, next) => next(e)) // progress is cosmetic: fail open

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await change($, 'main', t => (t ? { ...t, isBusy: false } : null))
    return r
  })

  // Every answered tool call is a step; task tools also move the bar. A subagent's call carries its agentId.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if ('deny' in r && r.deny) return r
    try {
      const id = e.agentId ? `s:${e.agentId}` : 'main'
      const isTask = (TASK_TOOLS as readonly string[]).includes(e.tool) && !('isError' in r && r.isError)
      await change($, id, (t, now) => {
        const base = t ?? blank(id, id === 'main' ? 'main' : 'sub', id === 'main' ? 'Claude' : 'subagent', now)
        const items = isTask ? (applyTask(base.items, e.tool, e, 'result' in r ? r.result : null) ?? base.items) : base.items
        return { ...base, items, steps: base.steps + 1, updatedAt: now, ...(id !== 'main' && { isBusy: true }) }
      })
    } catch {
      // progress is cosmetic: never let it break a tool call
    }
    return r
  }).catch(($, e, next) => next(e)) // progress is cosmetic: fail open

  // ── footer chip ─────────────────────────────────────────────────────────
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const b = await read($, board)
    const now = await $.clock.now()
    const live = b.tracks.filter(t => t.endedAt === null)
    const lead = live.find(t => t.id === 'main' && t.items.length > 0) ?? live.find(t => t.items.length > 0 && t.isBusy)
    const others = live.filter(t => t !== lead && t.isBusy && t.kind !== 'main').length
    if (!lead && others === 0) return below
    let chip = null
    if (lead) {
      const bar = barOf(lead, now, b.isMotionOn)
      const { done, total } = summary(lead.items)
      const parts = textBar(fillAt(bar, now), 6)
      chip = (
        <Text key="progress-bar">
          <Text color={hex(TONE[bar.tone])} backgroundColor={hex(TRACK)}>{parts.full + parts.part}</Text>
          <Text backgroundColor={hex(TRACK)}>{parts.empty}</Text>
          <Text color={hex(TONE[bar.tone])}>{` ${done}/${total}`}</Text>
        </Text>
      )
    }
    return (
      <Box justifyContent="space-between">
        <Box flexGrow={1}>{below}</Box>
        <Box key="progress-chip" columnGap={1} marginLeft={2}>
          {chip}
          <Button
            key="progress-open"
            plain
            label={others > 0 ? `+${others} agent${others > 1 ? 's' : ''}` : 'progress'}
            hover={{ color: hex(TONE.blue), bold: true }}
            onPress={() => openPane($)}
          />
        </Box>
      </Box>
    )
  })

  // ── pane ────────────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Raster = e.surface === 'terminal' && 'Raster' in els ? els.Raster : null
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const b = await read($, board)
    const now = await $.clock.now()
    const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
    const shown = b.tracks.filter(t => t.endedAt === null || now - t.endedAt <= KEEP_MS)
    const session = b.view === 'workers' ? [] : shown.filter(t => t.kind !== 'worker')
    const workers = shown.filter(t => t.kind === 'worker').sort((x, y) => Number(x.endedAt !== null) - Number(y.endedAt !== null))

    for (const t of workers) {
      const v = vendorOf(t.model)
      if (Svg && v && !svgs.has(v)) {
        const s = await $.fs.read(`${$.plugin.root}/assets/providers-svg/${v}.svg`).catch(() => null)
        svgs.set(v, typeof s === 'string' ? s : '')
      }
    }

    const avatar = (t: Track) => {
      if (t.kind === 'main') return <Text key={`av-${t.id}`} color="#d97757">✻</Text>
      if (t.kind === 'sub') return <Text key={`av-${t.id}`} color="#b083f0">◇</Text>
      const v = vendorOf(t.model)
      const grid = Raster ? pixels?.[v] : undefined
      if (grid)
        return (
          <Box key={`av-${t.id}`} flexDirection="column" width={8}>
            {[0, 2, 4, 6].map(y => (
              <Text key={`av-${t.id}-${y}`}>
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
        )
      const svg = svgs.get(v)
      if (Svg && svg) return <Svg key={`av-${t.id}`} source={svg} width={28} height={28} alt={v} />
      return <Text key={`av-${t.id}`} bold color="#768390">{(v[0] ?? '?').toUpperCase()}</Text>
    }

    const row = (t: Track) => {
      const bar = barOf(t, now, b.isMotionOn)
      const { done, total, current } = summary(t.items)
      const isStalled = bar.tone === 'yellow'
      const label =
        t.outcome === 'failed' ? '✗' : t.endedAt !== null || (total > 0 && done === total) ? `✓ ${total ? `${done}/${total}` : ''}` : total ? `${done}/${total}` : `${t.steps} steps`
      const elapsed = clockDur((t.endedAt ?? now) - t.startedAt)
      const step = t.endedAt !== null ? (t.outcome === 'failed' ? 'failed' : 'finished') : isStalled ? `stalled · no update for ${clockDur(now - t.updatedAt)}` : current ?? (t.isBusy ? 'working…' : 'idle')
      const graphic = Raster ? (
        <Raster key={`bar-${t.id}`} columns={W} rows={1} cells={encode(frame(bar, now, W))} />
      ) : Svg ? (
        <Svg key={`bar-${t.id}`} source={svgBar(bar, now)} width={200} height={8} alt={label} isInteractive={e.surface !== 'mobile' && b.isMotionOn} />
      ) : (
        <Text key={`bar-${t.id}`} color={hex(TONE[bar.tone])}>{textBar(bar.to ?? 0, 12).full || '·'}</Text>
      )
      return (
        <Box key={`row-${t.id}`} columnGap={1} marginBottom={1}>
          {avatar(t)}
          <Box key={`body-${t.id}`} flexDirection="column">
            <Box key={`head-${t.id}`} columnGap={1}>
              <Text bold>{t.name}</Text>
              {t.kind === 'worker' && t.mode ? <Text color={MODE_COLOR[t.mode] ?? '#768390'}>{MODE_WORD[t.mode] ?? t.mode}</Text> : null}
              {t.model ? <Text dimColor>{t.model}</Text> : null}
            </Box>
            <Box key={`line-${t.id}`} columnGap={1} alignItems="center">
              {graphic}
              <Text color={hex(TONE[bar.tone])}>{label}</Text>
              <Text dimColor>{elapsed}</Text>
            </Box>
            <Text dimColor>{step}</Text>
          </Box>
        </Box>
      )
    }

    const tab = (v: Board['view'], text: string) => (
      <Button
        key={`tab-${v}`}
        plain
        label={b.view === v ? `[${text}]` : text}
        hover={{ bold: true }}
        onPress={async () => {
          denied.clear()
          await update($, board, x => ({ ...x, view: v }))
          kick($)
        }}
      />
    )
    const staleMins = Math.round(STALL_MS / 60_000)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box key="tabs" columnGap={2} marginBottom={1}>
          {tab('all', 'All')}
          {tab('workers', 'Workers')}
          <Text dimColor>{b.isMotionOn ? '' : 'motion off'}</Text>
        </Box>
        {b.view === 'all' ? (
          <Box key="sec-session" flexDirection="column">
            <Text bold color="#768390">THIS SESSION</Text>
            {session.length ? session.map(row) : <Text dimColor>No task list yet. Bars appear once an agent keeps one.</Text>}
          </Box>
        ) : null}
        <Box key="sec-workers" flexDirection="column" marginTop={1}>
          <Text bold color="#768390">WORKERS</Text>
          {workers.length ? workers.map(row) : <Text dimColor>No cheap workers running (tmux session cw).</Text>}
        </Box>
        <Text dimColor>{`stalled = no update for ${staleMins}m · finished rows hide after 10m`}</Text>
      </Box>
    )
  })
}
