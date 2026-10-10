export type Row = { taskId: string; job: string; verdict: string; escalated: boolean; cost: number }
export type JobStats = { job: string; runs: number; fails: number; escalated: number; cost: number }
export type Summary = { running: string[]; recent: Row[]; jobs: JobStats[]; cost: number }

declare module 'claude-code' {
  interface PluginState {
    'cw-pane': { summary: Summary | null }
  }
}
