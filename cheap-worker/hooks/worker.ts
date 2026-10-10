import type { Mode, OrModel } from '../types'

export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash'

/** Where workers' model calls go: OpenRouter (any model, your key) or Amazon Bedrock (Claude only). */
export type Provider = 'openrouter' | 'bedrock'
/** How workers are shown: panes tiled in tmux session `cw`, or one tmux session each, opened as a terminal tab. */
export type LaunchMode = 'panes' | 'tabs'

// Bedrock's choices: Claude Code's own aliases, written as slugs so the picker,
// pins and the Anthropic avatar work unchanged. No catalog fetch, no prices.
export const BEDROCK_MODELS: OrModel[] = ['sonnet', 'opus', 'haiku'].map(a => ({ id: `anthropic/${a}`, inPerM: 0, outPerM: 0 }))
export const defaultModelFor = (p: Provider) => (p === 'bedrock' ? 'anthropic/sonnet' : DEFAULT_MODEL)

/**
 * AppleScript for Ghostty 1.3+: a new tab in the front window that attaches to the
 * worker's tmux session, then re-selects the tab you were on so focus doesn't jump.
 */
export function ghosttyTabScript(session: string): string {
  if (!/^cw-[a-z0-9]+$/.test(session)) throw new Error(`not a worker session: ${session}`)
  return [
    'tell application "Ghostty"',
    '  set cfg to new surface configuration',
    `  set initial input of cfg to "crew ${session} || tmux attach -t =${session}" & linefeed`,
    '  if (count of windows) is 0 then',
    '    new window with configuration cfg',
    '  else',
    '    set w to front window',
    '    set here to selected tab of w',
    '    new tab in w with configuration cfg',
    '    select tab here',
    '  end if',
    'end tell',
  ].join('\n')
}

// An OpenRouter slug, `vendor/name` with an optional `:variant`; anything else
// never reaches the shell.
export const isSlug = (s: string) => /^[a-z0-9][\w.-]*\/[\w.-]+(:[\w.-]+)?$/i.test(s)

/** Single-quotes `s` for a POSIX shell. */
export const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * The zsh script a worker pane runs. The key is referenced, never inlined:
 * the pane's zsh expands $CW_OPENROUTER_API_KEY from ~/.zshenv, so it never
 * appears in tmux's or ps's argument lists.
 */
export function workerScript(opts: { name: string; model: string; mode: Mode; task: string; contextTokens?: number; provider?: Provider }): string {
  if (!isSlug(opts.model)) throw new Error(`not an OpenRouter model id: ${opts.model}`)
  const m = opts.model
  if (opts.provider === 'bedrock') {
    const alias = m.split('/')[1]
    if (!BEDROCK_MODELS.some(b => b.id === m) || !alias) throw new Error(`not a Bedrock model choice: ${m}`)
    // Bedrock config (CLAUDE_CODE_USE_BEDROCK, AWS_*) lives in user settings, so they
    // must load: no --setting-sources here. Claude Code maps the alias to the Bedrock id.
    return `exec command claude -n ${opts.name} --model ${alias} --strict-mcp-config --permission-mode ${opts.mode}${opts.task ? ` ${sq(opts.task)}` : ''}`
  }
  return [
    'export ANTHROPIC_BASE_URL=https://openrouter.ai/api ANTHROPIC_AUTH_TOKEN=$CW_OPENROUTER_API_KEY ANTHROPIC_API_KEY=',
    `export ANTHROPIC_DEFAULT_OPUS_MODEL=${m} ANTHROPIC_DEFAULT_SONNET_MODEL=${m} ANTHROPIC_DEFAULT_HAIKU_MODEL=${m} CLAUDE_CODE_SUBAGENT_MODEL=${m}`,
    // Claude Code doesn't know OpenRouter models and assumes 200k; give it the real window.
    ...(opts.contextTokens && Number.isInteger(opts.contextTokens) ? [`export CLAUDE_CODE_MAX_CONTEXT_TOKENS=${opts.contextTokens}`] : []),
    // Same flags cw proved in Phase 0: no user hooks/plugins or MCP servers ride along.
    `exec command claude -n ${opts.name} --model sonnet --setting-sources project,local --strict-mcp-config --permission-mode ${opts.mode}${opts.task ? ` ${sq(opts.task)}` : ''}`,
  ].join('\n')
}

/** Compacts OpenRouter's /models payload to the tool-capable models, cheapest input first. */
export function parseModels(json: string): OrModel[] {
  const data = (JSON.parse(json) as { data?: unknown[] }).data ?? []
  return data
    .flatMap(raw => {
      const m = raw as {
        id?: string
        context_length?: number
        pricing?: { prompt?: string; completion?: string; input_cache_read?: string }
        supported_parameters?: string[]
      }
      if (!m.id || !isSlug(m.id) || !m.supported_parameters?.includes('tools')) return []
      return [
        {
          id: m.id,
          inPerM: Number(m.pricing?.prompt ?? 0) * 1e6,
          outPerM: Number(m.pricing?.completion ?? 0) * 1e6,
          ...(m.pricing?.input_cache_read !== undefined && { cachePerM: Number(m.pricing.input_cache_read) * 1e6 }),
          ...(Number.isInteger(m.context_length) && { contextTokens: m.context_length }),
        },
      ]
    })
    .sort((a, b) => a.inPerM - b.inPerM)
}

/** Every space-separated word of `query` in the id; the first `limit`, cheapest first. */
export function search(models: readonly OrModel[], query: string, limit = 6): OrModel[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return models.filter(m => words.every(w => m.id.toLowerCase().includes(w))).slice(0, limit)
}

export const price = (m: OrModel | undefined) =>
  m ? `$${+m.inPerM.toFixed(2)}/$${+m.outPerM.toFixed(2)} per M` : 'price unknown'

/** What the list shows: search hits while searching, else pins then recent picks. */
export function choicesFor(models: readonly OrModel[], query: string, pins: readonly string[], recent: readonly string[]): string[] {
  const hits = search(models, query)
  if (hits.length > 0) return hits.map(m => m.id)
  return [...pins, ...recent.filter(r => !pins.includes(r))]
}

/** Gone from a loaded catalog; never claimed while the catalog is empty (offline, loading). */
export const isRetired = (models: readonly OrModel[], id: string) => models.length > 0 && !models.some(m => m.id === id)

/** Reads the stored pin list, dropping anything that isn't a slug. */
export const toPins = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && isSlug(x)) : []

/** `tmux list-panes -F '#{pane_id}|#{@cw}'` → labelled worker panes (unlabelled panes aren't workers). */
export function parsePanes(stdout: string): { pane: string; name: string }[] {
  return stdout
    .split('\n')
    .map(line => line.split('|'))
    .filter(([pane, name]) => pane?.startsWith('%') && name)
    .map(([pane, name]) => ({ pane: pane as string, name: name as string }))
}

// Claude Code's frame: rules, the empty prompt, the footer hints. Not what the worker is doing.
const CHROME = /^[─━│┃╭╮╰╯▐▛▜▝▘\s]*$|^❯\s*$|shift\+tab|esc to interrupt|\? for shortcuts|auto mode on|accept edits on/

/** The last `n` meaningful lines of a captured pane, each cut to `width`. */
export function peekLines(capture: string, n = 2, width = 72): string[] {
  return capture
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim() !== '' && !CHROME.test(l))
    .slice(-n)
    .map(l => (l.trim().length > width ? `${l.trim().slice(0, width - 1)}…` : l.trim()))
}

/** A cross-session delivery's sender and body: `<cross-session-message … from-name="cw-ping" …>body</…>`. */
export function parsePeer(text: string): { from: string; body: string } {
  const from = text.match(/from-name="([^"]+)"/)?.[1] ?? text.match(/from="([^"]+)"/)?.[1] ?? 'peer'
  const body = text.match(/<cross-session-message[^>]*>([\s\S]*?)<\/cross-session-message>/)?.[1] ?? text
  return { from, body: body.trim() }
}

/** This session's own name, from the ListAgents tool's first line ("This session is <name> [ref] …"). */
export const leadFrom = (listAgents: string) => listAgents.match(/This session is (.+?) \[[0-9a-f]+\]/)?.[1] ?? null

/** The team note a worker launched with "team" on reads before its task. */
export function teamPreamble(opts: { name: string; teammates: readonly string[]; lead: string | null }): string {
  const mates = opts.teammates.filter(t => t !== opts.name)
  return [
    `You are ${opts.name}, a worker on a team of Claude Code sessions on this machine.`,
    mates.length > 0
      ? `Teammates right now: ${mates.join(', ')}. More may join; the ListAgents tool lists every session.`
      : 'No teammates yet; the ListAgents tool lists sessions that join later.',
    'Coordinate with the SendMessage tool: hand off work, ask a teammate for a result, or tell them what you changed. Keep messages short and specific.',
    opts.lead
      ? `Your lead is the session named "${opts.lead}". SendMessage it when you finish (one-line summary and where the result is) or when you are blocked. Copy the lead on decisions that affect other workers.`
      : 'When you finish or are blocked, say so in your own output.',
    'Messages from teammates arrive as new prompts; answer them, then continue your task.',
  ].join('\n')
}

/** Claude Code's transcript folder for a working directory: every / and . becomes -. */
export const projectDir = (home: string, cwd: string) => `${home}/.claude/projects/${cwd.replace(/[/.]/g, '-')}`

export type Usage = { input: number; cacheRead: number; cacheWrite: number; output: number; lastPrompt: number }

/** Token totals of one transcript; a streamed reply repeats its message id, so each id counts once. */
export function usageFrom(jsonl: string): Usage {
  const seen = new Set<string>()
  const u: Usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, lastPrompt: 0 }
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"usage"')) continue
    let d: { type?: string; message?: { id?: string; usage?: Record<string, number> } }
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    const m = d.message
    if (d.type !== 'assistant' || !m?.usage || !m.id || seen.has(m.id)) continue
    seen.add(m.id)
    const x = m.usage
    u.input += x.input_tokens ?? 0
    u.cacheRead += x.cache_read_input_tokens ?? 0
    u.cacheWrite += x.cache_creation_input_tokens ?? 0
    u.output += x.output_tokens ?? 0
    u.lastPrompt = (x.input_tokens ?? 0) + (x.cache_read_input_tokens ?? 0) + (x.cache_creation_input_tokens ?? 0)
  }
  return u
}

/** ≈ USD at the model's listed rates (cache reads at the cache rate when listed, else input rate). */
export const costOf = (u: Usage, m: OrModel | undefined) =>
  m ? ((u.input + u.cacheWrite) * m.inPerM + u.cacheRead * (m.cachePerM ?? m.inPerM) + u.output * m.outPerM) / 1e6 : null

export const tokensOf = (u: Usage) => u.input + u.cacheRead + u.cacheWrite + u.output

export const vendorOf = (model: string) => model.split('/')[0]?.replace(/^~/, '') ?? ''

export const kfmt = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

/** 0:27, 12:05, 1:02:09 */
export function clockDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

/** Claude Code shows "esc to interrupt" only while a turn runs. */
export const isWorking = (capture: string) => /esc to interrupt/.test(capture)

/** The full model id from a worker's startup banner ("deepseek/deepseek-v4.1-flash · API Usage Billing"). */
export const bannerModel = (capture: string) => capture.match(/([a-z0-9][\w.-]*\/[\w.:-]+) · API Usage Billing/i)?.[1] ?? null

/** Pane metadata every session can read: tmux options set at launch, tab-separated by list-panes. */
export const META_FORMAT = '#{pane_id}\t#{@cw}\t#{@cw_model}\t#{@cw_mode}\t#{@cw_start}\t#{@cw_cwd}\t#{@cw_task}'
export type PaneMeta = { pane: string; name: string; model: string; mode: string; start: number | null; cwd: string; task: string }
export function parseMeta(stdout: string): PaneMeta[] {
  return stdout
    .split('\n')
    .map(l => l.split('\t'))
    .filter(f => f[0]?.startsWith('%') && f[1])
    .map(([pane, name, model, mode, start, cwd, ...task]) => ({
      pane: pane!, name: name!, model: model ?? '', mode: mode ?? '',
      start: start && /^\d+$/.test(start) ? Number(start) : null, cwd: cwd ?? '', task: task.join('\t'),
    }))
}
