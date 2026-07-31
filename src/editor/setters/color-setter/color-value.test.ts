import { describe, expect, it } from 'vitest'
import { toNativeColorValue } from './color-value'

describe('toNativeColorValue', () => {
  it.each([
    ['#67C6D9', '#67c6d9'],
    ['#abc', '#aabbcc'],
    ['#abcd', '#aabbcc'],
    ['#112233cc', '#112233'],
  ])('normalizes %s for a native color input', (value, expected) => {
    expect(toNativeColorValue(value)).toBe(expected)
  })

  it.each([undefined, '', 'var(--dashboard-background)', 'rgb(1, 2, 3)', '#12'])(
    'uses a safe fallback for %s',
    value => {
      expect(toNativeColorValue(value)).toBe('#000000')
    },
  )
})
