import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { SKINS, skinOf, themeFile, themeRef } from './skins'
import type { Skin } from './skins'

const PANE = 'skins'
const applied = atom({ plugin: 'skins', key: 'applied' } as const, null as string | null)

// Claude Code reads custom themes from ~/.claude/themes/<slug>.json and watches the folder.
async function installThemes($: EngineInterface) {
  const home = await $.env.get('HOME')
  if (!home) return
  for (const s of SKINS) {
    const path = `${home}/.claude/themes/skin-${s.slug}.json`
    const want = themeFile(s)
    if ((await $.fs.read(path).catch(() => null)) !== want) await $.fs.write(path, want)
  }
}

// /config's theme row only takes the built-in themes, so a custom one is set the way the
// settings schema allows it: "theme": "custom:<slug>" in ~/.claude/settings.json.
async function settingsPath($: EngineInterface) {
  const home = await $.env.get('HOME')
  return home ? `${home}/.claude/settings.json` : null
}

async function currentTheme($: EngineInterface): Promise<string | undefined> {
  const path = await settingsPath($)
  const raw = path ? await $.fs.read(path).catch(() => null) : null
  try {
    const t = typeof raw === 'string' ? (JSON.parse(raw) as { theme?: unknown }).theme : undefined
    if (typeof t === 'string') return t
  } catch {
    // unreadable settings: fall back to /config's view
  }
  const row = (await $.config.list().catch(() => [])).find(r => r.key === 'theme')
  return typeof row?.value === 'string' ? row.value : undefined
}

/** `value` null removes the key (back to the default theme). Only the theme key changes. */
export function withTheme(settingsJson: string, value: string | null): string {
  const d = JSON.parse(settingsJson) as Record<string, unknown>
  if (value === null) delete d.theme
  else d.theme = value
  return `${JSON.stringify(d, null, 2)}\n`
}

async function apply($: EngineInterface, value: string | null, label: string) {
  const path = await settingsPath($)
  const raw = path ? await $.fs.read(path).catch(() => null) : null
  try {
    if (!path || typeof raw !== 'string') throw new Error('~/.claude/settings.json not readable')
    await $.fs.write(path, withTheme(raw, value))
    await update($, applied, () => value ?? 'dark')
    $.ui.toast(`Skin: ${label}`)
  } catch (err) {
    $.ui.toast(`Couldn't switch skin: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'skins', description: 'Pick a colour skin for Claude Code' })
    await installThemes($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'skins' }, async $ => {
    await installThemes($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: 'Skins' })
    return { text: 'Skins open.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const last = await read($, applied) // read every draw, so applying a skin redraws the pane
    const theme = (await currentTheme($)) ?? last ?? undefined
    const inUse = skinOf(theme)

    const card = (s: Skin) => {
      const isOn = inUse?.slug === s.slug
      return (
        <Box key={`skin-${s.slug}`} flexDirection="column" width="48%" marginBottom={1}>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={isOn ? s.accent : s.subtle}
            backgroundColor={s.bg}
            paddingX={1}
          >
            <Box justifyContent="space-between">
              <Text bold color={s.fg}>{s.name}</Text>
              {isOn && <Text color={s.accent}>✓</Text>}
            </Box>
            <Text color={s.fg}>
              <Text color={s.orange}>✎ </Text>
              <Text bold color={s.orange}>Edit</Text> units.js
            </Text>
            <Text color={s.fg}>
              <Text color={s.yellow}>›_ </Text>
              <Text bold color={s.yellow}>Run</Text> tests
            </Text>
            <Text>
              {[s.cyan, s.orange, s.yellow, s.purple, s.green, s.red].map((col, i) => (
                <Text key={`dot-${s.slug}-${i}`} color={col}>● </Text>
              ))}
            </Text>
          </Box>
          <Button
            key={`use-${s.slug}`}
            label={isOn ? 'In use' : `Use ${s.name}`}
            variant={isOn ? 'secondary' : 'primary'}
            onPress={() => (isOn ? undefined : apply($, themeRef(s), s.name))}
          />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Skins</Text>
        <Text dimColor>Pick one to recolour tool rows, borders, diffs and the spinner.</Text>
        <Box flexWrap="wrap" justifyContent="space-between" marginTop={1}>
          {SKINS.map(card)}
        </Box>
        <Box key="default-row" columnGap={1}>
          <Button
            key="use-default"
            plain
            dimColor={!inUse}
            label={inUse ? '↺ back to the default dark theme' : `current: ${theme ?? 'default'}`}
            onPress={() => (inUse ? apply($, null, 'default') : undefined)}
          />
        </Box>
      </Box>
    )
  })
}
