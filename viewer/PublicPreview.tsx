import { ProjectSchemaRenderer } from '@/pages/preview/ProjectSchemaRenderer'
import { useEffect, useState } from 'react'
import { ViewerState } from './ViewerState'
import { createCookieLessDataSourceEngine } from './data-source-engine'
import { PublicProjectNotFoundError, getPublishedProject } from './public-project-api'

export function PublicPreview({
  slug,
  releaseNumber,
  pageId,
}: {
  slug: string
  releaseNumber: number | null
  pageId: string | null
}) {
  const [projectDetail, setProjectDetail] = useState<Awaited<ReturnType<typeof getPublishedProject>> | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    void retryKey
    let cancelled = false

    const load = async () => {
      setProjectDetail(null)
      setError(null)

      try {
        const detail = await getPublishedProject(slug, releaseNumber)
        if (!cancelled) setProjectDetail(detail)
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason : new Error('公开项目加载失败'))
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [releaseNumber, retryKey, slug])

  if (error) {
    const notFound = error instanceof PublicProjectNotFoundError
    return (
      <ViewerState
        code={notFound ? '404 / RELEASE' : '503 / VIEWER'}
        title={notFound ? '发布地址不存在' : '公开大屏暂时无法加载'}
        detail={notFound ? '该大屏可能尚未发布、已取消发布或已移入回收站。' : '发布内容读取失败，请检查网络后重试。'}
        tone='error'
        actionLabel={notFound ? undefined : '重新加载'}
        onAction={notFound ? undefined : () => setRetryKey(value => value + 1)}
      />
    )
  }

  if (!projectDetail) {
    return <ViewerState code='VIEW / RELEASE' title='正在加载公开大屏…' detail='正在校验发布状态并读取不可变版本。' />
  }

  return (
    <ProjectSchemaRenderer
      project={projectDetail}
      requestedPageId={pageId}
      createDataSourceEngine={createCookieLessDataSourceEngine}
    />
  )
}
