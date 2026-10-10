export type Slice = { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' | 'deferred' }
export type ContextView = { used: number; max: number; compactAt: number | null; slices: Slice[] }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { view: ContextView | null; isHidden: boolean }
  }
}
