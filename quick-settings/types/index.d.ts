/** A per-request override, used only when the slash command didn't take. */
export type Override = { model?: string; effort?: string }

export type Settings = {
  /** The effort the last main-thread request went out with (null before the first). */
  lastEffort: string | null
  /** An effort chosen here, waiting for the next request to confirm it. */
  pendingEffort: string | null
  override: Override
  /** One line of feedback in the pane after a choice. */
  flash: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'quick-settings': { settings: Settings }
  }
}
