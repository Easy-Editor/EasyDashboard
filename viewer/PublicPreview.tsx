import { PreviewState } from '@/pages/preview/PreviewState'
import { ProjectSchemaRenderer } from '@/pages/preview/ProjectSchemaRenderer'
import { useEffect, useState } from 'react'
import { createCookieLessDataSourceEngine } from './data-source-engine'
import { getPublishedProject } from './public-project-api'

export function PublicPreview({ slug }: { slug: string }) {
  const [projectDetail, setProjectDetail] = useState<Awaited<ReturnType<typeof getPublishedProject>> | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setProjectDetail(null)
      setError(null)

      try {
        const detail = await getPublishedProject(slug)
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
  }, [slug])

  if (error) {
    return <PreviewState title='无法加载公开预览' detail={error.message} />
  }

  if (!projectDetail) {
    return <PreviewState title='正在读取已发布项目…' />
  }

  return <ProjectSchemaRenderer project={projectDetail} createDataSourceEngine={createCookieLessDataSourceEngine} />
}
