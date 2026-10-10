import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Settings } from '../types'
import { CONTROLS } from './controls'
import type { Ctx } from './controls'

const settings = atom({ plugin: 'quick-settings', key: 'settings' } as const, {
  lastEffort: null,
  pendingEffort: null,
  override: {},
  flash: null,
} as Settings)

const PANE = 'quick-settings'
const ACCENT = '#d97757'

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Quick settings' })

function ctxOf($: EngineInterface): Ctx {
  return {
    sessionModel: () => $.session.model(),
    run: (command, args) => $.command.run({ command, args }),
    get: () => read($, settings),
    set: fn => update($, settings, fn),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'quick-settings', description: 'Open the model and effort switcher' })
    return next(e)
  })

  on('command.run', { command: 'quick-settings' }, async $ => {
    await open($)
    return { text: 'Quick settings open.' }
  })

  // Watches the effort each main-thread request carries; applies an override
  // only where a slash command didn't take.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const s = await read($, settings)
    const sent = e.effort === undefined ? null : String(e.effort)
    if (s.pendingEffort !== null && sent !== s.pendingEffort && s.override.effort === undefined) {
      const wanted = s.pendingEffort
      await update($, settings, x => ({ ...x, override: { ...x.override, effort: wanted }, pendingEffort: null }))
      $.ui.toast(`/effort didn't take; ${wanted} applied per request instead.`)
    } else if (s.pendingEffort !== null) {
      await update($, settings, x => ({ ...x, pendingEffort: null }))
    }
    const o = (await read($, settings)).override
    const step = o.model || o.effort ? { ...e, ...(o.model && { model: o.model }), ...(o.effort && { effort: o.effort as never }) } : e
    await update($, settings, x => ({ ...x, lastEffort: step.effort === undefined ? x.lastEffort : String(step.effort) }))
    return yield* next(step)
  })

  // The footer button, bottom right, beside the engine's own hint line.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const ctx = ctxOf($)
    const parts = await Promise.all(
      CONTROLS.filter(c => c.short).map(async c => c.short?.(await c.current(ctx)) ?? ''),
    )
    return (
      <Box justifyContent="space-between">
        <Box flexGrow={1}>{below}</Box>
        <Button key="qs-open" label={`⚙ ${parts.join(' · ')}`} plain dimColor onPress={() => open($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, settings)
    const ctx = ctxOf($)
    const rows = await Promise.all(CONTROLS.map(async c => ({ c, now: await c.current(ctx) })))

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        {rows.map(({ c, now }) => (
          <Box key={`row-${c.id}`} flexDirection="column">
            <Text bold color={ACCENT}>{c.label}</Text>
            <Box flexWrap="wrap" columnGap={1}>
              {c.options.map(o => (
                <Button
                  key={`${c.id}-${o.value}`}
                  label={o.value === now ? `● ${o.label}` : `○ ${o.label}`}
                  variant={o.value === now ? 'primary' : 'secondary'}
                  onPress={async () => {
                    const line = await c.apply(ctxOf($), o.value)
                    await update($, settings, x => ({ ...x, flash: line }))
                  }}
                />
              ))}
            </Box>
            <Text dimColor>{c.options.find(o => o.value === now)?.note ?? ' '}</Text>
          </Box>
        ))}
        {s.flash && <Text color="#57ab5a">✓ {s.flash}</Text>}
        {(s.override.model || s.override.effort) && (
          <Text color="#e8c46a">
            per-request override: {[s.override.model, s.override.effort].filter(Boolean).join(' · ')}
          </Text>
        )}
      </Box>
    )
  })
}
