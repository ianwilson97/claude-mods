export type Guard = { isOn: boolean; todo: string | null; isSearchAsked: boolean }

declare module 'claude-code' {
  interface PluginState {
    'driver-seat-guard': { guard: Guard }
  }
}
