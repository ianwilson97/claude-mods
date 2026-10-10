import { test, expect } from 'claude-code/testing'

const cat = (name: string, tokens: number, kind: 'used' | 'free' = 'used') => ({ name, tokens, color: 'text', isDeferred: false, kind })

test('band draws fill, compaction point and legend on terminal and desktop', async ($, on) => {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {
        window: 1_000_000,
        breakdown: {
          categories: [cat('System prompt', 4200), cat('System tools', 17_000), cat('MCP tools', 52_000), cat('Memory files', 8600), cat('Messages', 0), cat('Free space', 897_000, 'free')],
          totalTokens: 90_000,
          maxTokens: 1_000_000,
          rawMaxTokens: 1_000_000,
          percentage: 9,
          isAutoCompactEnabled: true,
          autoCompactThreshold: 987_000,
        },
      },
      rateLimits: [],
    },
  }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-bar', surface, component: 'AbovePrompt', props: { hasSurvey: false } })
    expect(await ui.find({ type: 'Text', text: /compacts at 987k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 9% / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /mcp tools/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^messages/ })).toBeUndefined()
    await ui.unmount()
  }
})
