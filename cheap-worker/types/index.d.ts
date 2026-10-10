/** One OpenRouter model that takes tools, prices in USD per million tokens. */
export type OrModel = { id: string; inPerM: number; outPerM: number; cachePerM?: number; contextTokens?: number }
export type Mode = 'acceptEdits' | 'auto' | 'default'
export type Launch = {
  name: string
  model: string
  mode: Mode
  pane: string
  task: string
  isLive: boolean
  startedAt?: number
  /** Where it ran, to find its transcript. */
  cwd?: string
  /** Its transcript, once found. */
  transcript?: string
  /** When the pane was first seen gone. */
  endedAt?: number
}

/** Read from a worker's transcript. */
export type WStats = { tokens: number; cost: number | null; ctxPct: number | null }

/** A live worker pane in tmux session `cw`, joined with what this mod launched there (if it did). */
export type Active = { pane: string; name: string; launch: Launch | null; peek: string[]; isClosing: boolean; isBusy: boolean }

/** One message to or from a worker, as this session saw it. */
export type Msg = { dir: 'in' | 'out'; peer: string; text: string; at: number; isFailed?: boolean }

export type Picker = {
  model: string
  mode: Mode
  query: string
  /** Fetched when the pane opens; empty until then or when offline. */
  models: OrModel[]
  recent: string[]
  /** Starred models, kept across sessions in $.store; the first is the default. */
  pins: string[]
  launched: Launch[]
  flash: { text: string; isError: boolean } | null
  /** Refreshed from tmux every few seconds. */
  active: Active[]
  /** Panes sent /exit, awaiting the force-kill check. */
  closing: string[]
  /** Launch the next worker as a team member (teammates + lead in its prompt). */
  team: boolean
  /** Newest last, capped. */
  messages: Msg[]
  /** Per worker name. */
  stats: Record<string, WStats>
  showFinished: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cheap-worker': { picker: Picker }
  }
}
