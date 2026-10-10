import type { AgentKind, MapState } from '../types'

export const EDIT_TOOLS: readonly string[] = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

/** The file an edit tool's input names. */
export function editPath(input: unknown): string | null {
  const i = (input ?? {}) as { file_path?: unknown; notebook_path?: unknown }
  const p = i.file_path ?? i.notebook_path
  return typeof p === 'string' && p ? p : null
}

/** `abs` relative to `cwd`, or `abs` itself when it's outside the project. */
export function relTo(cwd: string, abs: string): string {
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`
  return abs.startsWith(root) ? abs.slice(root.length) : abs
}
export const isOutside = (path: string) => path.startsWith('/')

/** `agent` starts editing `path`: whatever it was on before is done (green) from here. */
export function touch(m: MapState, agent: { id: string; name: string; kind: AgentKind }, path: string, at: number): MapState {
  const prev = m.edits[path]
  const others = m.agents.filter(a => a.id !== agent.id)
  return {
    ...m,
    agents: [...others, { ...agent, file: path }],
    edits: { ...m.edits, [path]: { at, by: [...new Set([...(prev?.by ?? []), agent.id])] } },
  }
}

/** `agent` is finished: its file goes green, its icon goes away. */
export const finish = (m: MapState, id: string): MapState =>
  m.agents.some(a => a.id === id && a.file !== null) ? { ...m, agents: m.agents.map(a => (a.id === id ? { ...a, file: null } : a)) } : m

export type FileState = 'active' | 'done' | null
export function fileState(m: MapState, path: string): FileState {
  if (m.agents.some(a => a.file === path)) return 'active'
  const e = m.edits[path]
  return e && e.at > (m.reviewed[path] ?? -Infinity) ? 'done' : null
}

/** Every edit in a worker's transcript (tail), oldest first, with its time. */
export function workerEdits(jsonl: string): { path: string; at: number }[] {
  const out: { path: string; at: number }[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.startsWith('{') || !line.includes('tool_use')) continue
    let row: { timestamp?: string; message?: { content?: unknown } }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const at = Date.parse(row.timestamp ?? '')
    const content = row.message?.content
    if (!Array.isArray(content) || Number.isNaN(at)) continue
    for (const c of content as { type?: string; name?: string; input?: unknown }[]) {
      const p = c.type === 'tool_use' && EDIT_TOOLS.includes(c.name ?? '') ? editPath(c.input) : null
      if (p) out.push({ path: p, at })
    }
  }
  return out
}

export type Row = { key: string; depth: number; name: string; path: string; isDir: boolean; isOpen: boolean; count: number; state: FileState }

type Dir = { dirs: Map<string, Dir>; files: string[]; count: number }

/**
 * The tree as rows. A directory opens when it holds a red or green file (or the person
 * opened it) unless the person shut it; a closed one shows its file count. Capped at `cap` rows.
 */
export function rows(m: MapState, cap = 400): { rows: Row[]; isCut: boolean } {
  const inside = [...new Set([...m.files, ...Object.keys(m.edits).filter(p => !isOutside(p))])]
  const root: Dir = { dirs: new Map(), files: [], count: 0 }
  for (const f of inside) {
    const parts = f.split('/')
    let d = root
    d.count++
    for (const seg of parts.slice(0, -1)) {
      let next = d.dirs.get(seg)
      if (!next) d.dirs.set(seg, (next = { dirs: new Map(), files: [], count: 0 }))
      next.count++
      d = next
    }
    d.files.push(parts.at(-1)!)
  }
  const hot = new Set<string>()
  for (const p of inside) {
    if (fileState(m, p) === null) continue
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) hot.add(parts.slice(0, i).join('/'))
  }
  const open = new Set(m.open)
  const shut = new Set(m.shut)
  const out: Row[] = []
  let isCut = false
  const walk = (d: Dir, prefix: string, depth: number) => {
    for (const name of [...d.dirs.keys()].sort()) {
      if (out.length >= cap) return void (isCut = true)
      const path = prefix + name
      const sub = d.dirs.get(name)!
      const isOpen = !shut.has(path) && (hot.has(path) || open.has(path))
      out.push({ key: `d:${path}`, depth, name, path, isDir: true, isOpen, count: sub.count, state: null })
      if (isOpen) walk(sub, `${path}/`, depth + 1)
    }
    for (const name of d.files.sort()) {
      if (out.length >= cap) return void (isCut = true)
      const path = prefix + name
      out.push({ key: `f:${path}`, depth, name, path, isDir: false, isOpen: false, count: 0, state: fileState(m, path) })
    }
  }
  walk(root, '', 0)
  return { rows: out, isCut }
}

// ── copied from cheap-worker/hooks/worker.ts (plugins can't import each other) ──
export const projectDir = (home: string, cwd: string) => `${home}/.claude/projects/${cwd.replace(/[/.]/g, '-')}`
export const META_FORMAT = '#{pane_id}\t#{@cw}\t#{@cw_model}\t#{@cw_mode}\t#{@cw_start}\t#{@cw_cwd}\t#{@cw_task}'
export function parseMeta(stdout: string): { pane: string; name: string; cwd: string }[] {
  return stdout
    .split('\n')
    .map(l => l.split('\t'))
    .filter(f => f[0]?.startsWith('%') && f[1])
    .map(f => ({ pane: f[0]!, name: f[1]!, cwd: f[5] ?? '' }))
}
export const isWorking = (capture: string) => /esc to interrupt/.test(capture)
