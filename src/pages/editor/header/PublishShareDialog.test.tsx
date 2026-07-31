import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  PUBLISH_SHARE_LABEL,
  PublishShareReleaseDetails,
  type PublishShareReleaseDetailsProps,
  RESTORE_RELEASE_CONFIRMATION,
  ReleaseHistoryLoadError,
  UNPUBLISH_CONFIRMATION,
  restoreReleaseAndReloadHistory,
} from './PublishShareDialog'

describe('publish and share panel', () => {
  it('uses one product label for the editor trigger and dialog', () => {
    expect(PUBLISH_SHARE_LABEL).toBe('发布与分享')
  })

  it('shows the stable latest URL and the immutable URL for this release', () => {
    const props: PublishShareReleaseDetailsProps = {
      projectName: '运营驾驶舱',
      releaseNumber: 4,
      publishedAt: '2026-07-30T05:05:06.000Z',
      stableUrl: 'https://viewer.example.com/view/operations-stable',
      versionUrl: 'https://viewer.example.com/view/operations-stable/versions/4',
      onCopy: () => undefined,
      onOpen: () => undefined,
    }

    const html = renderToStaticMarkup(<PublishShareReleaseDetails {...props} />)

    expect(html).toContain('稳定链接（始终指向最新发布）')
    expect(html).toContain('本次版本（发布后内容不会变化）')
    expect(html).toContain('https://viewer.example.com/view/operations-stable')
    expect(html).toContain('https://viewer.example.com/view/operations-stable/versions/4')
  })

  it('warns that every public URL becomes a 404 and drafts do not republish', () => {
    expect(UNPUBLISH_CONFIRMATION).toContain('稳定链接和所有版本链接')
    expect(UNPUBLISH_CONFIRMATION).toContain('404')
    expect(UNPUBLISH_CONFIRMATION).toContain('保存或恢复草稿不会重新发布')
  })

  it('renders an inline release-history failure with an explicit retry action', () => {
    const html = renderToStaticMarkup(
      <ReleaseHistoryLoadError message='网络连接中断' retrying={false} onRetry={() => undefined} />,
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('发布状态读取失败')
    expect(html).toContain('网络连接中断')
    expect(html).toContain('重新读取')
    expect(html).not.toContain('正在同步公开链接')
  })

  it('restores a release before refreshing the release history', async () => {
    const calls: string[] = []
    const restoreRelease = async (releaseNumber: number) => {
      calls.push(`restore:${releaseNumber}`)
    }
    const reloadHistory = async () => {
      calls.push('reload')
      return true
    }

    await expect(restoreReleaseAndReloadHistory(7, restoreRelease, reloadHistory)).resolves.toBe(true)

    expect(calls).toEqual(['restore:7', 'reload'])
  })

  it('keeps a completed restore successful when release history cannot refresh', async () => {
    const restoreRelease = async () => undefined
    const reloadHistory = async () => false

    await expect(restoreReleaseAndReloadHistory(7, restoreRelease, reloadHistory)).resolves.toBe(false)
  })

  it('states every destructive boundary before replacing the draft', () => {
    expect(RESTORE_RELEASE_CONFIRMATION).toContain('整项目的所有页面')
    expect(RESTORE_RELEASE_CONFIRMATION).toContain('当前草稿创建为可回滚备份')
    expect(RESTORE_RELEASE_CONFIRMATION).toContain('公开地址和当前线上版本保持不变')
  })
})
