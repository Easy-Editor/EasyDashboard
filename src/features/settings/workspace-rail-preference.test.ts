import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_RAIL_PREFERENCE_EVENT,
  WORKSPACE_RAIL_STORAGE_KEY,
  publishWorkspaceRailPreference,
  readCachedWorkspaceRailPreference,
  subscribeWorkspaceRailPreference,
} from './workspace-rail-preference'

describe('workspace rail preference cache', () => {
  const storage = new Map<string, string>()
  const listeners = new Map<string, (event: Event) => void>()
  const dispatchEvent = vi.fn((event: Event) => {
    listeners.get(event.type)?.(event)
    return true
  })

  beforeEach(() => {
    storage.clear()
    listeners.clear()
    dispatchEvent.mockClear()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      addEventListener: (type: string, listener: (event: Event) => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      dispatchEvent,
    })
    vi.stubGlobal(
      'CustomEvent',
      class<T> extends Event {
        detail: T

        constructor(type: string, init: CustomEventInit<T>) {
          super(type)
          this.detail = init.detail as T
        }
      },
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('defaults missing and invalid values to a collapsed rail', () => {
    expect(readCachedWorkspaceRailPreference('owner-a')).toBe('collapsed')
    storage.set(WORKSPACE_RAIL_STORAGE_KEY, 'overlay')
    expect(readCachedWorkspaceRailPreference('owner-a')).toBe('collapsed')
  })

  it('migrates the legacy browser preference once, then isolates users', () => {
    storage.set(WORKSPACE_RAIL_STORAGE_KEY, 'collapsed')

    expect(readCachedWorkspaceRailPreference('owner-a')).toBe('collapsed')
    expect(storage.get(`${WORKSPACE_RAIL_STORAGE_KEY}:owner-a`)).toBe('collapsed')
    expect(storage.has(WORKSPACE_RAIL_STORAGE_KEY)).toBe(false)
    expect(readCachedWorkspaceRailPreference('owner-b')).toBe('collapsed')
  })

  it('caches and broadcasts only persisted rail preferences', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeWorkspaceRailPreference('owner-a', listener)

    publishWorkspaceRailPreference('collapsed', 'owner-b')
    expect(listener).not.toHaveBeenCalled()
    publishWorkspaceRailPreference('collapsed', 'owner-a')

    expect(storage.get(`${WORKSPACE_RAIL_STORAGE_KEY}:owner-a`)).toBe('collapsed')
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: WORKSPACE_RAIL_PREFERENCE_EVENT }))
    expect(listener).toHaveBeenCalledWith('collapsed')

    unsubscribe()
    publishWorkspaceRailPreference('docked', 'owner-a')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
