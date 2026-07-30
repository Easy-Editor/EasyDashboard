import { ProjectSchemaRenderer } from '@/pages/preview/ProjectSchemaRenderer'
import { useEffect, useState } from 'react'
import { createCookieLessDataSourceEngine } from './data-source-engine'
import { PublicProjectNotFoundError, getPublishedProject } from './public-project-api'

function ViewerMessage({ children }: { children: React.ReactNode }) {
  return <output className='grid min-h-screen place-items-center bg-black p-6 text-sm text-white'>{children}</output>
}

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

  useEffect(() => {
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
  }, [releaseNumber, slug])

  if (error) {
    return (
      <ViewerMessage>
        {error instanceof PublicProjectNotFoundError ? '404 · 该发布地址不存在或已下线。' : '公开大屏暂时无法加载。'}
      </ViewerMessage>
    )
  }

  if (!projectDetail) {
    return <ViewerMessage>正在加载…</ViewerMessage>
  }

  return (
    <ProjectSchemaRenderer
      project={projectDetail}
      requestedPageId={pageId}
      createDataSourceEngine={createCookieLessDataSourceEngine}
    />
  )
}
