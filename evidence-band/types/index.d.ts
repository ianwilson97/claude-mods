export type Evidence = { isAudit: boolean; code: string[]; docs: string[] }

declare module 'claude-code' {
  interface PluginState {
    'evidence-band': { evidence: Evidence }
  }
}
