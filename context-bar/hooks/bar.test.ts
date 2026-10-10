import { test, expect } from 'claude-code/testing'

import { cells, k } from './register'

const slice = (tokens: number) => ({ name: 'x', tokens, color: '#fff', kind: 'used' as const })

test('formats token counts', () => {
  expect([k(900), k(4200), k(90_000), k(1_000_000)]).toEqual(['900', '4.2k', '90k', '1M'])
})

test('cells fill the used share and keep tiny slices visible', () => {
  const sizes = cells([slice(4200), slice(52_000), slice(10)], 1_000_000, 100)
  expect(sizes.reduce((a, b) => a + b, 0)).toBe(6)
  expect(sizes[2]).toBe(1)
  expect(sizes[1]).toBe(4) // the 1-cell minimums come out of the largest slice
})

test('cells never exceed the width', () => {
  expect(cells([slice(700), slice(400)], 1000, 10).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10)
})
