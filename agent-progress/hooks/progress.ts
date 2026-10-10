import type { Item, Status, Track } from '../types'

export const STALL_MS = 3 * 60_000
export const KEEP_MS = 10 * 60_000
export const SLIDE_MS = 600
export const TICK_MS = 300
export const PULSE_MS = 400
export const SHIMMER_MS = 1500
export const FRAME_MS = 33

// ── task lists ────────────────────────────────────────────────────────────

const isStatus = (s: unknown): s is Status => s === 'pending' || s === 'in_progress' || s === 'completed'

/**
 * The task list after one TodoWrite / TaskCreate / TaskUpdate call, or null when the
 * call doesn't touch it. TodoWrite sends the whole list; TaskCreate's id comes from its
 * result; a TaskCreate after a fully completed list starts a new one.
 */
export function applyTask(items: readonly Item[], tool: string, input: unknown, result: unknown): Item[] | null {
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'TodoWrite') {
    const todos = Array.isArray(i.todos) ? (i.todos as Record<string, unknown>[]) : []
    return todos.map((t, n) => ({
      id: String(n),
      title: String(t.content ?? ''),
      active: String(t.activeForm ?? t.content ?? ''),
      status: isStatus(t.status) ? t.status : 'pending',
    }))
  }
  if (tool === 'TaskCreate') {
    const id = ((result ?? {}) as { task?: { id?: unknown } }).task?.id
    if (typeof id !== 'string' && typeof id !== 'number') return null
    const subject = String(i.subject ?? '')
    const item: Item = { id: String(id), title: subject, active: String(i.activeForm ?? subject), status: 'pending' }
    const isFresh = items.length > 0 && items.every(x => x.status === 'completed')
    return [...(isFresh ? [] : items.filter(x => x.id !== item.id)), item]
  }
  if (tool === 'TaskUpdate') {
    const id = String(i.taskId ?? '')
    if (!items.some(x => x.id === id)) return null
    if (i.status === 'deleted') return items.filter(x => x.id !== id)
    return items.map(x =>
      x.id !== id
        ? x
        : {
            ...x,
            ...(isStatus(i.status) && { status: i.status }),
            ...(typeof i.subject === 'string' && { title: i.subject }),
            ...(typeof i.activeForm === 'string' && { active: i.activeForm }),
          },
    )
  }
  return null
}

export const TASK_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate'] as const

/** done ÷ total and the in-progress step; `total` 0 means no list (indeterminate). */
export function summary(items: readonly Item[]): { done: number; total: number; current: string | null } {
  const done = items.filter(x => x.status === 'completed').length
  const cur = items.find(x => x.status === 'in_progress')
  return { done, total: items.length, current: cur ? cur.active || cur.title : null }
}

/**
 * A worker's task list from (the tail of) its transcript: tool_use rows on assistant
 * messages, their results on the following user rows. A tail may start mid-line (skipped)
 * and miss a TaskCreate (its later TaskUpdates are then ignored).
 */
export function fromTranscript(jsonl: string): { items: Item[]; steps: number; lastAt: number | null } {
  let items: Item[] = []
  let steps = 0
  let lastAt: number | null = null
  const pending = new Map<string, { name: string; input: unknown }>()
  for (const line of jsonl.split('\n')) {
    if (!line.startsWith('{')) continue
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN
    if (!Number.isNaN(at)) lastAt = at
    const content = (row.message as { content?: unknown } | undefined)?.content
    if (!Array.isArray(content)) continue
    for (const c of content as Record<string, unknown>[]) {
      if (c.type === 'tool_use' && typeof c.name === 'string') {
        steps++
        if (c.name === 'TodoWrite') items = applyTask(items, c.name, c.input, null) ?? items
        else if (c.name === 'TaskCreate' || c.name === 'TaskUpdate') pending.set(String(c.id), { name: c.name, input: c.input })
      } else if (c.type === 'tool_result') {
        const use = pending.get(String(c.tool_use_id))
        if (!use) continue
        pending.delete(String(c.tool_use_id))
        items = applyTask(items, use.name, use.input, row.toolUseResult) ?? items
      }
    }
  }
  return { items, steps, lastAt }
}

// ── copied from cheap-worker/hooks/worker.ts (plugins can't import each other) ──

export const projectDir = (home: string, cwd: string) => `${home}/.claude/projects/${cwd.replace(/[/.]/g, '-')}`
export const vendorOf = (model: string) => model.split('/')[0]?.replace(/^~/, '') ?? ''
export const META_FORMAT = '#{pane_id}\t#{@cw}\t#{@cw_model}\t#{@cw_mode}\t#{@cw_start}\t#{@cw_cwd}\t#{@cw_task}'
export type PaneMeta = { pane: string; name: string; model: string; mode: string; start: number | null; cwd: string }
export function parseMeta(stdout: string): PaneMeta[] {
  return stdout
    .split('\n')
    .map(l => l.split('\t'))
    .filter(([pane, name]) => pane?.startsWith('%') && name)
    .map(([pane, name, model, mode, start, cwd]) => ({
      pane: pane!,
      name: name!,
      model: model ?? '',
      mode: mode ?? '',
      start: start && /^\d+$/.test(start) ? Number(start) : null,
      cwd: cwd ?? '',
    }))
}
export function clockDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

// ── what a bar shows ──────────────────────────────────────────────────────

export type Tone = 'blue' | 'green' | 'yellow' | 'red'
export const TONE: Record<Tone, number> = { blue: 0x539bf5, green: 0x57ab5a, yellow: 0xc69026, red: 0xe5534b }
export const TRACK = 0x2d333b
export const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

export type Bar = {
  /** fraction before the last change */
  from: number
  /** fraction now; null = no task list (indeterminate) */
  to: number | null
  changedAt: number
  tone: Tone
  /** working right now: head, shimmer, bounce */
  isLive: boolean
  isMotionOn: boolean
}

export function barOf(t: Track, now: number, isMotionOn: boolean): Bar {
  const { done, total } = summary(t.items)
  const isStalled = t.endedAt === null && t.isBusy && now - t.updatedAt > STALL_MS
  const isDone = t.outcome === 'done' || (total > 0 && done === total)
  const tone: Tone = t.outcome === 'failed' ? 'red' : isDone ? 'green' : isStalled ? 'yellow' : 'blue'
  const to = t.endedAt !== null ? (t.outcome === 'failed' ? (total ? done / total : null) : 1) : total ? done / total : null
  return { from: t.from, to, changedAt: t.changedAt, tone, isLive: t.isBusy && !isStalled && t.endedAt === null && !isDone, isMotionOn }
}

/** Still frames once the slide, tick and pulse are over and nothing is working. */
export const isMoving = (b: Bar, now: number) => b.isMotionOn && (b.isLive || now - b.changedAt < SLIDE_MS + PULSE_MS)

const ease = (x: number) => 1 - (1 - x) ** 3
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const

/** The fill at `now`: sliding from `from` to `to` over SLIDE_MS. */
export function fillAt(b: Bar, now: number): number {
  if (b.to === null) return 0
  const dt = now - b.changedAt
  if (!b.isMotionOn || dt >= SLIDE_MS) return b.to
  return b.from + (b.to - b.from) * ease(Math.max(0, dt) / SLIDE_MS)
}

/** Whole cells and the eighth-block of the partial one, for `fill` of `width` cells. */
export function cellsOf(fill: number, width: number): { full: number; eighth: number } {
  const cells = Math.min(1, Math.max(0, fill)) * width
  let full = Math.floor(cells)
  let eighth = Math.round((cells - full) * 8)
  if (eighth === 8) (full++, (eighth = 0))
  return { full, eighth }
}

/** Left edge of the bouncing segment: 0 → width-seg → 0, one cell per 50ms. */
export function bounceX(now: number, width: number, seg = 3): number {
  const span = Math.max(1, width - seg)
  const pos = Math.floor(now / 50) % (2 * span)
  return pos <= span ? pos : 2 * span - pos
}

const lighten = (c: number, k: number) => {
  const ch = (s: number) => Math.round(((c >> s) & 0xff) + (255 - ((c >> s) & 0xff)) * Math.min(1, Math.max(0, k)))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** One frame: `width` cells as flat [codePoint, fg, bg] triplets. Pure, so it's testable. */
export function frame(b: Bar, now: number, width: number): number[] {
  const out: number[] = []
  const fill = TONE[b.tone]
  const cell = (ch: string, fg: number, bg: number) => out.push(ch.codePointAt(0)!, fg, bg)
  if (b.to === null) {
    const x0 = b.isLive && b.isMotionOn ? bounceX(now, width) : 0
    for (let x = 0; x < width; x++) cell(x >= x0 && x < x0 + 3 ? '█' : ' ', fill, TRACK)
    return out
  }
  const dt = now - b.changedAt
  const motion = b.isMotionOn
  const { full, eighth } = cellsOf(fillAt(b, now), width)
  const tickFrom = Math.floor(Math.min(b.from, b.to) * width)
  const isTick = motion && b.to > b.from && dt >= SLIDE_MS && dt < SLIDE_MS + TICK_MS
  const pulse = motion && b.tone === 'green' && b.to === 1 && dt >= SLIDE_MS && dt < SLIDE_MS + PULSE_MS ? Math.sin((Math.PI * (dt - SLIDE_MS)) / PULSE_MS) * 0.5 : 0
  const isSettled = !motion || dt >= SLIDE_MS
  const shimmer = b.isLive && motion && isSettled ? ((now % SHIMMER_MS) / SHIMMER_MS) * (full + 6) - 3 : null
  for (let x = 0; x < width; x++) {
    if (x < full) {
      let c = isTick && x >= tickFrom ? TONE.green : fill
      if (pulse) c = lighten(c, pulse)
      if (shimmer !== null) {
        const d = Math.abs(x - shimmer)
        if (d < 1.5) c = lighten(c, 0.3 * (1 - d / 1.5))
      }
      if (b.isLive && motion && isSettled && x === full - 1) c = lighten(c, 0.35)
      cell('█', c, TRACK)
    } else if (x === full && eighth > 0) cell(EIGHTHS[eighth]!, fill, TRACK)
    else cell(' ', fill, TRACK)
  }
  return out
}

/** RasterProps.cells: little-endian u32s, padded base64. */
export function encode(words: readonly number[]): string {
  const bytes = new Uint8Array(new Uint32Array(words).buffer)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

/** The footer's text bar: whole cells, the partial eighth, the empty rest. */
export function textBar(fill: number, width: number): { full: string; part: string; empty: string } {
  const { full, eighth } = cellsOf(fill, width)
  return { full: '█'.repeat(full), part: EIGHTHS[eighth]!, empty: ' '.repeat(Math.max(0, width - full - (eighth ? 1 : 0))) }
}

/** Desktop/vscode: the same bar as SVG; SMIL does the slide, shimmer and bounce. */
export function svgBar(b: Bar, now: number, w = 200, h = 8): string {
  const fill = hex(TONE[b.tone])
  const r = h / 2
  const animate = b.isMotionOn
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="${r}" fill="${hex(TRACK)}"/>`
  if (b.to === null) {
    const seg = w / 6
    const move = animate && b.isLive ? `<animate attributeName="x" values="0;${w - seg};0" dur="1.6s" repeatCount="indefinite"/>` : ''
    return `${head}<rect width="${seg}" height="${h}" rx="${r}" fill="${fill}">${move}</rect></svg>`
  }
  const sliding = animate && now - b.changedAt < SLIDE_MS
  const to = b.to * w
  const slide = sliding
    ? `<animate attributeName="width" from="${b.from * w}" to="${to}" dur="${SLIDE_MS / 1000}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.33 1 0.68 1"/>`
    : ''
  const shimmer =
    animate && b.isLive
      ? `<defs><linearGradient id="g"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><clipPath id="c"><rect width="${to}" height="${h}" rx="${r}"/></clipPath></defs><rect clip-path="url(#c)" x="${-w / 4}" width="${w / 4}" height="${h}" fill="url(#g)"><animate attributeName="x" from="${-w / 4}" to="${to}" dur="${SHIMMER_MS / 1000}s" repeatCount="indefinite"/></rect>`
      : ''
  return `${head}<rect width="${to}" height="${h}" rx="${r}" fill="${fill}">${slide}</rect>${shimmer}</svg>`
}
