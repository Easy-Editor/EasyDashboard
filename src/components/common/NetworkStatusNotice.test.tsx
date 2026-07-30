import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { NetworkStatusNotice } from './NetworkStatusNotice'

describe('NetworkStatusNotice', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: false },
    })
  })

  it('names the operations that require connectivity', () => {
    const html = renderToStaticMarkup(<NetworkStatusNotice />)

    expect(html).toContain('当前处于离线状态')
    expect(html).toContain('保存、发布与同步需等待网络恢复')
    expect(html).toContain('<output')
  })
})
