/** The theme last applied from the pane; writing it redraws the pane (a settings change alone doesn't). */
export type Applied = string | null

declare module 'claude-code' {
  interface PluginState {
    skins: { applied: Applied }
  }
}
