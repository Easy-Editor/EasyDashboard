import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  PublishShareReleaseDetails,
  type PublishShareReleaseDetailsProps,
  UNPUBLISH_CONFIRMATION,
} from './PublishShareDialog'

describe('publish and share panel', () => {
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
})
