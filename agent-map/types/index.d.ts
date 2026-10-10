export type AgentKind = 'main' | 'sub' | 'worker'
/** An agent and the file it's editing right now (null: between files, or done). */
export type MapAgent = { id: string; name: string; kind: AgentKind; file: string | null }
export type Edit = { at: number; by: string[] }
export type MapState = {
  agents: MapAgent[]
  /** path (relative to the session cwd, or absolute when outside it) → last edit */
  edits: Record<string, Edit>
  /** path → when the person marked it reviewed; green again only after a newer edit */
  reviewed: Record<string, number>
  /** the project's files (git ls-files), relative */
  files: string[]
  /** directories the person opened / closed by hand */
  open: string[]
  shut: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'agent-map': { map: MapState }
  }
}
