# ianwilson-mods

Claude Code mods (function-hook plugins). Each folder is one plugin; `.claude-plugin/marketplace.json` makes this repo a marketplace.

| Mod | What it does |
| --- | --- |
| `cheap-worker` | `/worker` spins up Claude Code workers from a picker; `/workers` lists, messages and closes them. Team mode lets workers find each other (ListAgents) and talk (SendMessage). |
| `agent-progress` | `/progress`: animated progress bar per agent (main, subagents, workers) from their task lists. |
| `agent-map` | `/map`: project file tree; red 🔨 = an agent is editing it, green ✓ = done, ready for review. |
| `context-bar` | Context-window breakdown above the prompt. |
| `usage-meter` | 5-hour / weekly usage in the footer. |
| `quick-settings` | ⚙ footer button for model and effort. |
| `skins` | `/skins`: colour themes (Tokyo Night, Dracula, Gruvbox, …). |
| `cw-pane`, `driver-seat-guard`, `evidence-band` | For the driver-seat workflow; skip them elsewhere. |

## Install

```
/plugin marketplace add ianwilson97/claude-mods
/plugin install cheap-worker@ianwilson-mods
/plugin install agent-progress@ianwilson-mods
/plugin install agent-map@ianwilson-mods
```

On the machine where this folder is the live copy (loaded through `CLAUDE_CODE_PLUGIN_DIRS`), don't also install from the marketplace: each mod would load twice.

## cheap-worker: two switches

Set per machine in `/config` (or `pluginConfigs.cheap-worker.options` in `~/.claude/settings.json`):

| Option | Values | |
| --- | --- | --- |
| `provider` | `openrouter` (default) | Any OpenRouter model; key read from `$CW_OPENROUTER_API_KEY` (export it in `~/.zshenv`). Workers skip user settings, hooks and plugins. |
| | `bedrock` | Claude only (Sonnet / Opus / Haiku). Workers keep your user settings, so the Bedrock env there (`CLAUDE_CODE_USE_BEDROCK`, `AWS_REGION`, `AWS_PROFILE`, …) applies. No call to openrouter.ai. |
| `launch` | `panes` (default) | All workers tiled in tmux session `cw`: `tmux new -A -s cw`. |
| | `tabs` | Each worker gets a tmux session of its own and opens in a new Ghostty tab (focus stays where you were). |

Work laptop: `provider = bedrock`, `launch = tabs`.

### Reaching a worker: `crew`

The mod installs `crew` into `~/.local/bin` (that folder must be on your `PATH`; it never overwrites a different `crew`).

```
crew            # list running workers, pick one by number
crew ab12c      # attach to cw-ab12c
```

If Ghostty can't be scripted (macOS asks once to let Claude control Ghostty; a managed Mac may refuse), the worker still runs: press CMD+T and run `crew`. Closing a tab only detaches; the worker keeps running until you close it from `/workers`.

Needs: tmux, Ghostty 1.3+ for auto-opened tabs.

## First run on a new machine: checks

1. `/plugin` lists the mods as enabled. Managed settings can block marketplaces or plugins; if so, nothing loads.
2. `/worker`, launch one with task `say hi`; a Ghostty tab opens (or the toast says `CMD+T, then crew …`).
3. Turn on **team**, launch two workers, then from `/workers` send one a message: messaging is Claude Code's own (ListAgents / SendMessage) and works under Bedrock unless policy turns it off.
