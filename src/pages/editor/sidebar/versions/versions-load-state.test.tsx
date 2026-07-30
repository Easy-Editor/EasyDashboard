import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RestorePointsLoadError, resolveRestorePointListState } from './versions-load-state'

describe('versions sidebar load state', () => {
  it('does not turn an initial load failure into a false empty state', () => {
    expect(
      resolveRestorePointListState({
        isLoading: false,
        loadError: '网络连接中断',
        restorePointCount: 0,
      }),
    ).toBe('error')
  })

  it('keeps already loaded restore points visible when a refresh fails', () => {
    expect(
      resolveRestorePointListState({
        isLoading: false,
        loadError: '网络连接中断',
        restorePointCount: 2,
      }),
    ).toBe('content')
  })

  it('renders a persistent inline error with an explicit retry action', () => {
    const html = renderToStaticMarkup(
      <RestorePointsLoadError message='网络连接中断' retrying={false} onRetry={() => undefined} />,
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('版本记录读取失败')
    expect(html).toContain('网络连接中断')
    expect(html).toContain('重新读取')
    expect(html).not.toContain('暂无恢复点')
  })
})
