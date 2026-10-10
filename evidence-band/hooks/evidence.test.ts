import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { bashPaths, sort } from './register'

const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: [],
  tools: [],
  outputStyle: null,
  traits: [],
}
const say = ($: Engine, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
const ids = async ($: Engine) => (await $.prompt.compose(COMPOSE)).sections.map(s => s.id)

test('sorts docs from code', () => {
  const ev = sort(['docs/api.md', 'src/kms.ts', 'README.md', '.driver-seat/todos/001-x.md', 'src/kms.ts'], {
    isAudit: true,
    code: [],
    docs: [],
  })
  expect(ev.code).toEqual(['src/kms.ts'])
  expect(ev.docs).toEqual(['docs/api.md', 'README.md', '.driver-seat/todos/001-x.md'])
})

test('pulls paths from read-only bash only', () => {
  expect(bashPaths('sed -n 1,40p src/main.rs | head')).toEqual(['src/main.rs'])
  expect(bashPaths('grep -n parse docs/spec.md src/lib.rs')).toEqual(['docs/spec.md', 'src/lib.rs'])
  expect(bashPaths('rm -rf build/')).toEqual([])
})

test('citation rule only on audit prompts', async ($, on) => {
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }))

  await say($, 'fix the header parser')
  expect(await ids($)).not.toContain('evidence-band:cite')

  await say($, 'what is the status of Sprint 1?')
  expect(await ids($)).toContain('evidence-band:cite')
})
