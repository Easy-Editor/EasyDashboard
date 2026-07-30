import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PreviewRenderFailure, PreviewState } from './PreviewState'

describe('preview product states', () => {
  it('renders a loading state with an explicit retry action', () => {
    const html = renderToStaticMarkup(
      <PreviewState
        title='正在读取项目草稿…'
        detail='加载时间较长时，可以重新发起一次读取。'
        action={<button type='button'>重新加载</button>}
      />,
    )

    expect(html).toContain('正在读取项目草稿')
    expect(html).toContain('重新加载')
    expect(html).toContain('role="status"')
  })

  it('names the page that failed while keeping render retry available', () => {
    const html = renderToStaticMarkup(
      <PreviewRenderFailure pageLabel='区域态势' error={new Error('地图物料初始化失败')} onRetry={vi.fn()} />,
    )

    expect(html).toContain('页面「区域态势」渲染失败')
    expect(html).toContain('地图物料初始化失败')
    expect(html).toContain('重试渲染')
    expect(html).toContain('role="alert"')
  })
})
