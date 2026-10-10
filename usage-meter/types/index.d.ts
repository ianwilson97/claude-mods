export type Window = { kind: string; percentUsed: number; resetsAt?: string }
export type Meter = { windows: Window[]; costUsd: number | null; measuredAt: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { meter: Meter | null; footerHidden: boolean; warned: string[] }
  }
}
