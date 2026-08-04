import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ViewerState } from './ViewerState'

describe('ViewerState', () => {
  it('renders the calibrated viewer state without workspace chrome', () => {
    const html = renderToStaticMarkup(
      <ViewerState code='TECHNICAL LABEL' title='发布地址不存在' detail='该版本已下线。' tone='error' />,
    )

    expect(html).toContain('data-ed-shell="viewer"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('发布地址不存在')
    expect(html).not.toContain('TECHNICAL LABEL')
    expect(html).not.toContain('aria-hidden')
    expect(html).not.toContain('我的项目')
  })

  it('renders a recovery action when one is available', () => {
    const html = renderToStaticMarkup(<ViewerState title='暂时无法加载' actionLabel='重新加载' onAction={vi.fn()} />)

    expect(html).toContain('<button')
    expect(html).toContain('重新加载')
  })
})
