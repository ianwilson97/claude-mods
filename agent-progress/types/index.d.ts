export type Status = 'pending' | 'in_progress' | 'completed'
export type Item = { id: string; title: string; active: string; status: Status }
export type Kind = 'main' | 'sub' | 'worker'
export type Track = {
  id: string
  kind: Kind
  name: string
  model: string
  mode: string
  items: Item[]
  /** tool calls seen: the indeterminate bar's label */
  steps: number
  startedAt: number
  /** last sign of life (a tool call, a transcript row): stalled after 3 min */
  updatedAt: number
  endedAt: number | null
  outcome: 'done' | 'failed' | null
  isBusy: boolean
  /** animation: the fraction before the last change, and when it changed */
  from: number
  changedAt: number
}
export type Board = {
  tracks: Track[]
  isNudgeOn: boolean
  isMotionOn: boolean
  view: 'all' | 'workers'
}

declare module 'claude-code' {
  interface PluginState {
    'agent-progress': { board: Board }
  }
}
