import { describe, expect, it } from 'vitest'
import { resolveClampedFloatingPosition } from './popover-position'

describe('configure popover viewport positioning', () => {
  it('moves an overflowing right-side popover fully into the viewport', () => {
    expect(
      resolveClampedFloatingPosition({ left: 1738, top: 287, width: 218, height: 233 }, { width: 1920, height: 963 }),
    ).toEqual({ left: 1690, top: 287 })
  })

  it('keeps an already visible popover anchored in place', () => {
    expect(
      resolveClampedFloatingPosition({ left: 120, top: 160, width: 218, height: 233 }, { width: 1440, height: 900 }),
    ).toEqual({ left: 120, top: 160 })
  })

  it('also keeps the popover clear of the viewport bottom edge', () => {
    expect(
      resolveClampedFloatingPosition({ left: 120, top: 780, width: 218, height: 233 }, { width: 1440, height: 900 }),
    ).toEqual({ left: 120, top: 655 })
  })
})
