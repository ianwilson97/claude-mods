/** One skin: a palette that `overridesFor` spreads over every key of Claude Code's theme. */
export type Skin = {
  slug: string
  name: string
  bg: string; panel: string; fg: string; muted: string; subtle: string; accent: string
  blue: string; green: string; red: string; yellow: string; purple: string; cyan: string; orange: string; pink: string
}

export const SKINS: readonly Skin[] = [
  { slug: 'noir', name: 'Noir', bg: '#121212', panel: '#1f1f1f', fg: '#e6e6e6', muted: '#8a8a8a', subtle: '#4a4a4a', accent: '#ffffff', blue: '#cfcfcf', green: '#d6d6d6', red: '#ff6b6b', yellow: '#e6e6e6', purple: '#bdbdbd', cyan: '#dedede', orange: '#e0e0e0', pink: '#ff8a8a' },
  { slug: 'tokyo-night', name: 'Tokyo Night', bg: '#1a1b26', panel: '#24283b', fg: '#c0caf5', muted: '#565f89', subtle: '#3b4261', accent: '#ff9e64', blue: '#7aa2f7', green: '#9ece6a', red: '#f7768e', yellow: '#e0af68', purple: '#bb9af7', cyan: '#7dcfff', orange: '#ff9e64', pink: '#ff007c' },
  { slug: 'dracula', name: 'Dracula', bg: '#282a36', panel: '#343746', fg: '#f8f8f2', muted: '#6272a4', subtle: '#44475a', accent: '#ffb86c', blue: '#8be9fd', green: '#50fa7b', red: '#ff5555', yellow: '#f1fa8c', purple: '#bd93f9', cyan: '#8be9fd', orange: '#ffb86c', pink: '#ff79c6' },
  { slug: 'catppuccin', name: 'Catppuccin', bg: '#1e1e2e', panel: '#313244', fg: '#cdd6f4', muted: '#6c7086', subtle: '#45475a', accent: '#cba6f7', blue: '#89b4fa', green: '#a6e3a1', red: '#f38ba8', yellow: '#f9e2af', purple: '#cba6f7', cyan: '#89dceb', orange: '#fab387', pink: '#f5c2e7' },
  { slug: 'gruvbox', name: 'Gruvbox', bg: '#282828', panel: '#32302f', fg: '#ebdbb2', muted: '#928374', subtle: '#504945', accent: '#fe8019', blue: '#83a598', green: '#b8bb26', red: '#fb4934', yellow: '#fabd2f', purple: '#d3869b', cyan: '#8ec07c', orange: '#fe8019', pink: '#d3869b' },
  { slug: 'everforest', name: 'Everforest', bg: '#2d353b', panel: '#343f44', fg: '#d3c6aa', muted: '#859289', subtle: '#4f585e', accent: '#a7c080', blue: '#7fbbb3', green: '#a7c080', red: '#e67e80', yellow: '#dbbc7f', purple: '#d699b6', cyan: '#83c092', orange: '#e69875', pink: '#d699b6' },
  { slug: 'nordic', name: 'Nordic', bg: '#2e3440', panel: '#3b4252', fg: '#d8dee9', muted: '#616e88', subtle: '#434c5e', accent: '#88c0d0', blue: '#81a1c1', green: '#a3be8c', red: '#bf616a', yellow: '#ebcb8b', purple: '#b48ead', cyan: '#88c0d0', orange: '#d08770', pink: '#b48ead' },
  { slug: 'monokai', name: 'Monokai', bg: '#272822', panel: '#3e3d32', fg: '#f8f8f2', muted: '#75715e', subtle: '#49483e', accent: '#a6e22e', blue: '#66d9ef', green: '#a6e22e', red: '#f92672', yellow: '#e6db74', purple: '#ae81ff', cyan: '#66d9ef', orange: '#fd971f', pink: '#f92672' },
]

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
const rgb = ([r, g, b]: number[]) => `rgb(${r},${g},${b})`
/** `amount` of `a` over `b`, as Claude Code's theme writes colours. */
export const mix = (a: string, b: string, amount: number) => {
  const [x, y] = [hex(a), hex(b)]
  return rgb(x.map((v, i) => Math.round(v * amount + y[i]! * (1 - amount))))
}
const c = (h: string) => rgb(hex(h))

/** Every theme key Claude Code's base theme has, from one palette. */
export function overridesFor(s: Skin): Record<string, string> {
  const t: Record<string, string> = {
    text: c(s.fg), inverseText: c(s.bg), inactive: c(s.muted), inactiveShimmer: mix(s.fg, s.muted, 0.4), subtle: c(s.muted),
    promptBorder: c(s.muted), promptBorderShimmer: mix(s.fg, s.muted, 0.5),
    claude: c(s.accent), claudeShimmer: mix(s.fg, s.accent, 0.35), clawd_body: c(s.accent), clawd_background: c(s.bg), briefLabelClaude: c(s.accent),
    claudeBlue_FOR_SYSTEM_SPINNER: c(s.blue), claudeBlueShimmer_FOR_SYSTEM_SPINNER: mix(s.fg, s.blue, 0.35),
    permission: c(s.blue), permissionShimmer: mix(s.fg, s.blue, 0.35), suggestion: c(s.blue), ide: c(s.blue), professionalBlue: c(s.blue), briefLabelYou: c(s.blue),
    remember: c(s.purple), autoAccept: c(s.purple), autoAcceptShimmer: mix(s.fg, s.purple, 0.35), skill: c(s.purple), merged: c(s.purple), effortUltra: c(s.purple),
    planMode: c(s.cyan), background: c(s.cyan), bashBorder: c(s.pink),
    success: c(s.green), error: c(s.red), warning: c(s.yellow), warningShimmer: mix(s.fg, s.yellow, 0.35), chromeYellow: c(s.yellow),
    fastMode: c(s.orange), fastModeShimmer: mix(s.fg, s.orange, 0.35),
    diffAdded: mix(s.green, s.bg, 0.28), diffRemoved: mix(s.red, s.bg, 0.28), diffAddedDimmed: mix(s.green, s.bg, 0.14), diffRemovedDimmed: mix(s.red, s.bg, 0.14),
    diffAddedWord: mix(s.green, s.bg, 0.55), diffRemovedWord: mix(s.red, s.bg, 0.55),
    userMessageBackground: c(s.panel), userMessageBackgroundHover: mix(s.fg, s.panel, 0.06), composerSidebarBackground: c(s.panel),
    bashMessageBackgroundColor: c(s.panel), memoryBackgroundColor: c(s.panel), selectionBg: mix(s.blue, s.bg, 0.35),
    rate_limit_fill: c(s.blue), rate_limit_empty: c(s.subtle),
    red_FOR_SUBAGENTS_ONLY: c(s.red), blue_FOR_SUBAGENTS_ONLY: c(s.blue), green_FOR_SUBAGENTS_ONLY: c(s.green), yellow_FOR_SUBAGENTS_ONLY: c(s.yellow),
    purple_FOR_SUBAGENTS_ONLY: c(s.purple), orange_FOR_SUBAGENTS_ONLY: c(s.orange), pink_FOR_SUBAGENTS_ONLY: c(s.pink), cyan_FOR_SUBAGENTS_ONLY: c(s.cyan),
  }
  const rainbow = { red: s.red, orange: s.orange, yellow: s.yellow, green: s.green, blue: s.blue, indigo: s.purple, violet: s.pink }
  for (const [k, v] of Object.entries(rainbow)) {
    t[`rainbow_${k}`] = c(v)
    t[`rainbow_${k}_shimmer`] = mix(s.fg, v, 0.35)
  }
  return t
}

/** The file Claude Code reads from ~/.claude/themes/<slug>.json. */
export const themeFile = (s: Skin) => JSON.stringify({ name: s.name, base: 'dark', overrides: overridesFor(s) }, null, 2)
export const themeRef = (s: Skin) => `custom:skin-${s.slug}`
export const skinOf = (theme: unknown) => SKINS.find(s => themeRef(s) === theme) ?? null
