import { describe, expect, it } from 'vitest'
import { getSidebarOpenForModeTransition } from './editor-sidebar-mode'

describe('editor sidebar mode state contract', () => {
  it('opens on the initial canvas entry', () => {
    expect(getSidebarOpenForModeTransition(undefined, 'canvas')).toBe(true)
  })

  it('closes in code mode and reopens when returning to canvas', () => {
    expect(getSidebarOpenForModeTransition('canvas', 'code')).toBe(false)
    expect(getSidebarOpenForModeTransition('code', 'canvas')).toBe(true)
  })

  it('preserves an explicit close while remaining in canvas mode', () => {
    expect(getSidebarOpenForModeTransition('canvas', 'canvas')).toBeUndefined()
  })
})
