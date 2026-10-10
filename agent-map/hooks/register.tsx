import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentKind, MapAgent, MapState } from '../types'
import { EDIT_TOOLS, META_FORMAT, editPath, fileState, finish, isOutside, isWorking, parseMeta, projectDir, relTo, rows, touch, workerEdits } from './map'

const PANE = 'agent-map'
const RED = '#e5534b'
const GREEN = '#57ab5a'
const DIM = '#768390'
// Clawd's head, as Claude Code draws it at startup; one colour per kind of agent.
const CLAWD = '▐▛█▜▌'
const KIND_COLOR: Record<AgentKind, string> = { main: '#d97757', sub: '#b083f0', worker: '#c8f031' }

const DEFAULTS: MapState = { agents: [], edits: {}, reviewed: {}, files: [], open: [], shut: [] }
const map = atom({ plugin: 'agent-map', key: 'map' } as const, DEFAULTS)

const transcripts = new Map<string, string>()

async function run($: EngineInterface, argv: string[]) {
  const r = await $.process.run(argv).catch(() => null)
  return r?.exitCode === 0 ? r.stdout : ''
}

/** The project's files: git's list (ignores respected), else a shallow find. */
async function loadFiles($: EngineInterface) {
  const cwd = await $.session.cwd()
  let out = await run($, ['git', '-C', cwd, 'ls-files'])
  if (!out) {
    const found = await run($, ['find', cwd, '-maxdepth', '5', '-type', 'f', '-not', '-path', '*/.git/*', '-not', '-path', '*/node_modules/*'])
    out = found.split('\n').filter(Boolean).map(p => relTo(cwd, p)).join('\n')
  }
  // ponytail: 20k files max; past that the tree is unreadable anyway
  const files = out.split('\n').filter(Boolean).slice(0, 20_000)
  await update($, map, m => ({ ...m, files }))
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Agent map' })
  void loadFiles($)
  void refresh($)
}

/** Every 5s: subagents that finished go green; workers' edits from their transcripts. */
async function refresh($: EngineInterface) {
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const subs = await $.agent.list().catch(() => [])
  const running = new Set(subs.filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting').map(a => `s:${a.id}`))
  for (const a of (await read($, map)).agents) {
    if (a.kind === 'sub' && a.file !== null && !running.has(a.id)) await update($, map, m => finish(m, a.id))
  }

  const panes = parseMeta(await run($, ['tmux', 'list-panes', '-a', '-F', META_FORMAT]))
  const live = new Set<string>()
  for (const p of panes) {
    const id = `w:${p.name}`
    live.add(id)
    let file = transcripts.get(p.name)
    if (!file && home && p.cwd) {
      file = (await run($, ['grep', '-rl', '--include=*.jsonl', '-e', `"agentName":"${p.name}"`, projectDir(home, p.cwd)])).split('\n').find(Boolean)
      if (file) transcripts.set(p.name, file)
    }
    if (!file) continue
    // ponytail: last 2MB of the transcript; older edits drop out of the map
    const edits = workerEdits(await run($, ['tail', '-c', '2000000', file]))
    const isBusy = isWorking(await run($, ['tmux', 'capture-pane', '-p', '-J', '-t', p.pane]))
    await update($, map, m => {
      let next = m
      for (const e of edits) {
        const path = relTo(cwd, e.path)
        if ((next.edits[path]?.at ?? 0) < e.at) next = touch(next, { id, name: p.name, kind: 'worker' }, path, e.at)
      }
      const last = edits.at(-1)
      const want = isBusy && last ? relTo(cwd, last.path) : null
      const cur = next.agents.find(a => a.id === id)
      if (cur && cur.file !== want) next = { ...next, agents: next.agents.map(a => (a.id === id ? { ...a, file: want } : a)) }
      return next
    })
  }
  for (const a of (await read($, map)).agents) {
    if (a.kind === 'worker' && a.file !== null && !live.has(a.id)) await update($, map, m => finish(m, a.id))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'map', description: 'Agent map: which files agents are editing (/map, /map clear = mark all reviewed)' })
    await update($, map, m => ({ ...DEFAULTS, ...m }))
    $.clock.every(5000, () => void refresh($))
    return next(e)
  })

  on('command.run', { command: 'map' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      const now = await $.clock.now()
      await update($, map, m => ({ ...m, reviewed: { ...m.reviewed, ...Object.fromEntries(Object.keys(m.edits).map(p => [p, now])) } }))
      return { text: 'Agent map: every edited file marked reviewed.' }
    }
    await openPane($)
    return { text: 'Agent map open.' }
  })

  // Main agent and subagents: an answered edit moves the agent onto that file.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (!EDIT_TOOLS.includes(e.tool) || ('deny' in r && r.deny) || ('isError' in r && r.isError)) return r
    const abs = editPath(e)
    if (!abs) return r
    const path = relTo(await $.session.cwd(), abs)
    const now = await $.clock.now()
    let agent: Omit<MapAgent, 'file'> = { id: 'main', name: 'Claude', kind: 'main' }
    if (e.agentId) {
      const info = (await $.agent.list().catch(() => [])).find(a => a.id === e.agentId)
      agent = { id: `s:${e.agentId}`, name: info?.description || info?.name || 'subagent', kind: 'sub' }
    }
    await update($, map, m => touch(m, agent, path, now))
    return r
  }).catch(($, e, next) => next(e)) // the map is cosmetic: fail open

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await update($, map, m => finish(m, 'main'))
    return r
  })

  // ── footer chip: only while something is red or green ───────────────────
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const m = await read($, map)
    const paths = Object.keys(m.edits)
    const red = paths.filter(p => fileState(m, p) === 'active').length
    const green = paths.filter(p => fileState(m, p) === 'done').length
    if (red + green === 0) return below
    const label = [red ? `🔨 ${red}` : '', green ? `✓ ${green}` : ''].filter(Boolean).join(' · ')
    return (
      <Box justifyContent="space-between">
        <Box flexGrow={1}>{below}</Box>
        <Box key="map-chip" marginLeft={2}>
          <Button key="map-open" plain label={label} hover={{ color: GREEN, bold: true }} onPress={() => openPane($)} />
        </Box>
      </Box>
    )
  })

  // ── pane ────────────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const m = await read($, map)
    const now = await $.clock.now()
    const cwd = await $.session.cwd()
    const tree = rows(m)
    const outside = Object.keys(m.edits).filter(p => isOutside(p) && fileState(m, p) !== null)
    const agentsOn = (path: string) => m.agents.filter(a => a.file === path)
    const review = (path: string) => update($, map, x => ({ ...x, reviewed: { ...x.reviewed, [path]: now } }))
    const toggle = (path: string, isOpen: boolean) =>
      update($, map, x => ({
        ...x,
        open: isOpen ? x.open.filter(p => p !== path) : [...x.open, path],
        shut: isOpen ? [...x.shut, path] : x.shut.filter(p => p !== path),
      }))
    const red = Object.keys(m.edits).filter(p => fileState(m, p) === 'active').length
    const green = Object.keys(m.edits).filter(p => fileState(m, p) === 'done').length

    const fileLine = (key: string, path: string, name: string, depth: number) => {
      const state = fileState(m, path)
      const agents = agentsOn(path)
      return (
        <Box key={key} paddingLeft={depth * 2} columnGap={1}>
          <Text color={state === 'active' ? RED : state === 'done' ? GREEN : undefined} dimColor={state === null} bold={state !== null}>
            {name}
          </Text>
          {state === 'active' ? <Text>🔨</Text> : null}
          {agents.map(a => (
            <Text key={`ag-${a.id}`}>
              <Text color={KIND_COLOR[a.kind]}>{CLAWD}</Text>
              {a.kind === 'main' ? '' : <Text color={DIM}>{` ${a.name}`}</Text>}
            </Text>
          ))}
          {state === 'done' ? <Text color={GREEN}>✓</Text> : null}
          {state === 'done' ? <Button key={`rv-${path}`} plain dimColor label="×" hover={{ color: GREEN, bold: true }} onPress={() => review(path)} /> : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box key="legend" columnGap={2}>
          <Text color={RED}>{`🔨 ${red} editing`}</Text>
          <Text color={GREEN}>{`✓ ${green} ready for review`}</Text>
          {green > 0 ? (
            <Button
              key="review-all"
              plain
              dimColor
              label="mark all reviewed"
              hover={{ color: GREEN, bold: true }}
              onPress={() => update($, map, x => ({ ...x, reviewed: { ...x.reviewed, ...Object.fromEntries(Object.keys(x.edits).map(p => [p, now])) } }))}
            />
          ) : null}
        </Box>
        <Box key="agents" columnGap={2} marginBottom={1}>
          {m.agents
            .filter(a => a.file !== null)
            .map(a => (
              <Text key={`who-${a.id}`}>
                <Text color={KIND_COLOR[a.kind]}>{CLAWD}</Text>
                <Text color={DIM}>{` ${a.name} → ${a.file}`}</Text>
              </Text>
            ))}
        </Box>
        <Text key="root" bold>{`${cwd.split('/').pop() || cwd}/`}</Text>
        {tree.rows.length === 0 ? <Text key="empty" dimColor>Loading the file list…</Text> : null}
        {tree.rows.map(r =>
          r.isDir ? (
            <Box key={r.key} paddingLeft={r.depth * 2}>
              <Button
                key={`dir-${r.path}`}
                plain
                label={r.isOpen ? `▾ ${r.name}/` : `▸ ${r.name}/  (${r.count})`}
                hover={{ bold: true }}
                onPress={() => toggle(r.path, r.isOpen)}
              />
            </Box>
          ) : (
            fileLine(r.key, r.path, r.name, r.depth)
          ),
        )}
        {tree.isCut ? <Text key="cut" dimColor>… more files (collapse a folder to see the rest)</Text> : null}
        {outside.length > 0 ? (
          <Box key="outside" flexDirection="column" marginTop={1}>
            <Text bold color={DIM}>OUTSIDE THIS PROJECT</Text>
            {outside.map(p => fileLine(`o:${p}`, p, p, 0))}
          </Box>
        ) : null}
      </Box>
    )
  })
}
