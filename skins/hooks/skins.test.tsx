import { test, expect } from 'claude-code/testing'

import { SKINS, mix, overridesFor, skinOf, themeFile } from './skins'
import { withTheme } from './register'

// The keys Claude Code 2.1.295's base theme defines (overrides outside it are dropped).
const BASE_KEYS = 'autoAccept autoAcceptShimmer skill bashBorder claude claudeShimmer claudeBlue_FOR_SYSTEM_SPINNER claudeBlueShimmer_FOR_SYSTEM_SPINNER permission permissionShimmer planMode ide promptBorder promptBorderShimmer text inverseText inactive inactiveShimmer subtle suggestion remember background success error warning merged warningShimmer diffAdded diffRemoved diffAddedDimmed diffRemovedDimmed diffAddedWord diffRemovedWord red_FOR_SUBAGENTS_ONLY blue_FOR_SUBAGENTS_ONLY green_FOR_SUBAGENTS_ONLY yellow_FOR_SUBAGENTS_ONLY purple_FOR_SUBAGENTS_ONLY orange_FOR_SUBAGENTS_ONLY pink_FOR_SUBAGENTS_ONLY cyan_FOR_SUBAGENTS_ONLY professionalBlue chromeYellow clawd_body clawd_background userMessageBackground userMessageBackgroundHover composerSidebarBackground selectionBg bashMessageBackgroundColor memoryBackgroundColor rate_limit_fill rate_limit_empty fastMode fastModeShimmer effortUltra briefLabelYou briefLabelClaude rainbow_red rainbow_orange rainbow_yellow rainbow_green rainbow_blue rainbow_indigo rainbow_violet rainbow_red_shimmer rainbow_orange_shimmer rainbow_yellow_shimmer rainbow_green_shimmer rainbow_blue_shimmer rainbow_indigo_shimmer rainbow_violet_shimmer'.split(' ')

test('every skin covers every base key with rgb() colours, and nothing else', () => {
  for (const s of SKINS) {
    const o = overridesFor(s)
    expect(Object.keys(o).sort()).toEqual([...BASE_KEYS].sort())
    expect(Object.values(o).every(v => /^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/.test(v))).toBe(true)
  }
})

test('withTheme sets or removes only the theme key', () => {
  const base = JSON.stringify({ model: 'opus', theme: 'dark' })
  expect(JSON.parse(withTheme(base, 'custom:skin-noir'))).toEqual({ model: 'opus', theme: 'custom:skin-noir' })
  expect(JSON.parse(withTheme(base, null))).toEqual({ model: 'opus' })
})

test('theme file shape and lookup', () => {
  const f = JSON.parse(themeFile(SKINS[3]!))
  expect([f.name, f.base, f.overrides.claude]).toEqual(['Catppuccin', 'dark', 'rgb(203,166,247)'])
  expect(skinOf('custom:skin-gruvbox')?.name).toBe('Gruvbox')
  expect(skinOf('dark')).toBeNull()
  expect(mix('#ffffff', '#000000', 0.5)).toBe('rgb(128,128,128)')
  expect(SKINS.map(s => s.name)).toEqual(['Noir', 'Tokyo Night', 'Dracula', 'Catppuccin', 'Gruvbox', 'Everforest', 'Nordic', 'Monokai'])
})

test('pane: Use writes only the theme key into settings.json', async ($, on) => {
  let settings = JSON.stringify({ env: { A: '1' }, permissions: { allow: ['Read'] }, theme: 'custom:skin-catppuccin' }, null, 2)
  on('env.get', () => ({ value: '/Users/ian' }) as never)
  on('fs.read', () => ({ value: settings }) as never)
  on('fs.write', ($, e) => {
    settings = String((e as { text?: string }).text ?? (e as { content?: string }).content)
    return { value: undefined } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'skins', surface, component: 'Pane', requestId: 'skins', props: { title: 'Skins' } } as never)
    expect((await ui.findAll({ type: 'Button' })).filter(b => /^Use |In use/.test(b.text ?? '')).length).toBe(8)
    if (surface === 'terminal') {
      expect((await ui.find({ key: 'use-catppuccin' }))?.text).toBe('In use')
      await ui.press({ key: 'use-gruvbox' })
      expect((await ui.find({ key: 'use-gruvbox' }))?.text).toBe('In use')
    }
    await ui.unmount()
  }
  const d = JSON.parse(settings)
  expect(d.theme).toBe('custom:skin-gruvbox')
  expect(d.env).toEqual({ A: '1' })
  expect(d.permissions).toEqual({ allow: ['Read'] })
})
