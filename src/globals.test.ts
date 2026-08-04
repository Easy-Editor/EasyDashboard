import { afterEach, describe, expect, it, vi } from 'vitest'
import { initGlobals } from './globals'

describe('initGlobals', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exposes the automatic JSX runtime without treating list keys as children', () => {
    vi.stubGlobal('window', {})
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    initGlobals()

    const runtime = window.jsxRuntime
    expect(runtime).toBeDefined()

    const element = runtime?.jsxs(
      'div',
      {
        children: [runtime.jsx('span', { children: '名称' }), runtime.jsx('span', { children: '34.71%' })],
      },
      'shareholder-1',
    )
    const children = (element?.props as { children: Array<{ props: { children: string } }> }).children

    expect(element?.key).toBe('shareholder-1')
    expect(children).toHaveLength(2)
    expect(children[0]?.props.children).toBe('名称')
    expect(children[1]?.props.children).toBe('34.71%')
  })
})
