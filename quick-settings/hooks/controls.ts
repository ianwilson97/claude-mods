import type { Settings } from '../types'

/**
 * What a control can do, built from `$` in register.tsx (the engine only lets
 * `$` reach functions it can trace, so controls get closures, never `$`).
 * A new control that needs more (a config row, a file) adds a member here.
 */
export type Ctx = {
  sessionModel: () => Promise<string>
  run: (command: string, args: string) => Promise<unknown>
  get: () => Promise<Settings>
  set: (fn: (s: Settings) => Settings) => Promise<unknown>
}

export type Option = { value: string; label: string; note?: string }

/**
 * One row of the pane. To add a setting, write one of these and append it to
 * CONTROLS: the pane, the footer button and the tests pick it up from there.
 */
export type Control = {
  id: string
  label: string
  options: readonly Option[]
  /** The value in effect now, matched against `options[].value`; null when unknown. */
  current: (ctx: Ctx) => Promise<string | null>
  /** Puts `value` in effect; resolves to the line the pane shows afterwards. */
  apply: (ctx: Ctx, value: string) => Promise<string>
  /** Short form for the footer button; omit to leave the control out of it. */
  short?: (value: string | null) => string
}

// The session reports a full id (claude-sonnet-5-5); options are /model's aliases.
export const modelAlias = (id: string) =>
  ['fable', 'opus', 'sonnet', 'haiku'].find(alias => id.toLowerCase().includes(alias)) ?? id

export const model: Control = {
  id: 'model',
  label: 'Model',
  options: [
    { value: 'fable', label: 'fable', note: 'most capable' },
    { value: 'opus', label: 'opus', note: 'deep work' },
    { value: 'sonnet', label: 'sonnet', note: 'everyday' },
    { value: 'haiku', label: 'haiku', note: 'fast, cheap' },
  ],
  current: async ctx => (await ctx.get()).override.model ?? modelAlias(await ctx.sessionModel()),
  apply: async (ctx, value) => {
    await ctx.run('model', value)
    if (modelAlias(await ctx.sessionModel()) === value) {
      await ctx.set(s => ({ ...s, override: { ...s.override, model: undefined } }))
      return `Model set to ${value}.`
    }
    // ponytail: fallback rewrites each main-thread request; the status line keeps the old name
    await ctx.set(s => ({ ...s, override: { ...s.override, model: value } }))
    return `/model didn't take; ${value} applied per request instead.`
  },
  short: v => v ?? '?',
}

export const effort: Control = {
  id: 'effort',
  label: 'Effort',
  options: [
    { value: 'low', label: 'low', note: 'quick answers' },
    { value: 'medium', label: 'medium' },
    { value: 'high', label: 'high', note: 'default for most' },
    { value: 'xhigh', label: 'xhigh' },
    { value: 'max', label: 'max', note: 'hardest problems' },
  ],
  current: async ctx => {
    const s = await ctx.get()
    return s.override.effort ?? s.pendingEffort ?? s.lastEffort
  },
  apply: async (ctx, value) => {
    await ctx.run('effort', value)
    // Confirmed (or overridden) by the next request in turn.step.
    await ctx.set(s => ({ ...s, pendingEffort: value, override: { ...s.override, effort: undefined } }))
    return `Effort set to ${value}; confirmed on the next request.`
  },
  short: v => v ?? 'effort',
}

export const CONTROLS: readonly Control[] = [effort, model]
