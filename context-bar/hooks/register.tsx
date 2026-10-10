import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextView, Slice } from '../types'

const view = atom({ plugin: 'context-bar', key: 'view' } as const, null as ContextView | null)
const isHidden = atom({ plugin: 'context-bar', key: 'isHidden' } as const, false)

const PALETTE: [RegExp, string][] = [
  [/system prompt/i, '#7d8cf0'],
  [/system tools|^tools/i, '#6cc5c9'],
  [/mcp/i, '#9a7cf5'],
  [/agent/i, '#9fd17a'],
  [/memory/i, '#e8c46a'],
  [/skill/i, '#f09ab8'],
  [/slash|command/i, '#c9a0e8'],
  [/message/i, '#e07b5a'],
]
const colorFor = (name: string, fallback: string) => PALETTE.find(([re]) => re.test(name))?.[1] ?? fallback

export const k = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${n}`

// Splits `width` cells across used slices by share of `max`, largest remainder,
// every non-empty slice at least one cell so small categories stay visible.
export function cells(slices: readonly Slice[], max: number, width: number): number[] {
  const raw = slices.map(s => (s.tokens / Math.max(max, 1)) * width)
  const out = raw.map(r => (r > 0 ? Math.max(1, Math.floor(r)) : 0))
  const target = Math.min(width, Math.max(Math.round(raw.reduce((a, b) => a + b, 0)), out.filter(n => n > 0).length))
  const total = () => out.reduce((a, b) => a + b, 0)
  while (total() > target) {
    const i = out.indexOf(Math.max(...out))
    if ((out[i] ?? 0) <= 1) break
    out[i] = (out[i] ?? 0) - 1
  }
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (total() >= target) break
    out[i] = (out[i] ?? 0) + 1
  }
  return out.map(n => Math.min(n, width))
}

export const tone = (pct: number) => (pct >= 85 ? '#e5534b' : pct >= 60 ? '#e8c46a' : '#57ab5a')

async function compute($: EngineInterface): Promise<ContextView | null> {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  const b = usage?.context.breakdown
  if (!b) return null
  return {
    used: b.totalTokens,
    max: b.rawMaxTokens,
    compactAt: b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null,
    slices: b.categories
      .filter(c => c.kind === 'used' && c.tokens > 0)
      .map(c => ({ name: c.name.toLowerCase(), tokens: c.tokens, color: colorFor(c.name, c.color), kind: c.kind })),
  }
}

async function measure($: EngineInterface) {
  const next = await compute($)
  if (next) await update($, view, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'context-bar', description: 'Show or hide the context bar' })
    void measure($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) await measure($)
    return next(e)
  })

  on('command.run', { command: 'context-bar' }, async $ => {
    await update($, isHidden, h => !h)
    const hidden = await read($, isHidden)
    if (!hidden) await measure($)
    return { text: hidden ? 'Context bar hidden.' : 'Context bar shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const v = (await read($, view)) ?? (await compute($))
    if (v === null || e.props.hasSurvey || (await read($, isHidden))) return below
    const { Box, Text } = $.ui.resolve(e)

    const pct = Math.round((100 * v.used) / Math.max(v.max, 1))
    const width = Math.max(20, (e.viewport?.columns ?? 100) - 6)
    const sizes = cells(v.slices, v.max, width)
    const usedCells = sizes.reduce((a, b) => a + b, 0)
    const mark = v.compactAt === null ? -1 : Math.min(width - 1, Math.round((v.compactAt / v.max) * width))
    const free = Array.from({ length: Math.max(0, width - usedCells) }, (_, i) =>
      usedCells + i === mark ? '│' : '░',
    ).join('')

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor="#3b3f4a" paddingX={1}>
          <Box justifyContent="space-between">
            <Text>
              <Text color="#e07b5a">◆ </Text>
              <Text bold>context</Text>
            </Text>
            <Text>
              <Text bold>{k(v.used)}</Text>
              <Text dimColor> of {k(v.max)}{v.compactAt ? ` · compacts at ${k(v.compactAt)}` : ''} </Text>
              <Text backgroundColor={tone(pct)} color="#111111" bold>{` ${pct}% `}</Text>
            </Text>
          </Box>
          <Text>
            {v.slices.map((s, i) => (
              <Text key={`seg-${s.name}`} color={s.color}>{'█'.repeat(sizes[i] ?? 0)}</Text>
            ))}
            <Text color="#3b3f4a">{free}</Text>
          </Text>
          <Box flexWrap="wrap" columnGap={2}>
            {v.slices.map(s => (
              <Text key={`leg-${s.name}`}>
                <Text color={s.color}>■ </Text>
                {s.name} <Text bold>{k(s.tokens)}</Text>
                <Text dimColor> {Math.round((100 * s.tokens) / Math.max(v.max, 1))}%</Text>
              </Text>
            ))}
            <Text>
              <Text color="#3b3f4a">■ </Text>
              <Text dimColor>free {k(Math.max(0, v.max - v.used))}</Text>
            </Text>
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}
