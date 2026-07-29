import { Button } from '@/components/ui/button'
import { getProject } from '@/features/projects/project-api'
import { createDataSourceEngine } from '@easy-editor/plugin-datasource'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { PreviewState } from './PreviewState'
import { type PreviewDataSourceEngine, ProjectSchemaRenderer } from './ProjectSchemaRenderer'

function DraftProjectPreview({ projectId }: { projectId: string }) {
  const [projectDetail, setProjectDetail] = useState<Awaited<ReturnType<typeof getProject>> | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setProjectDetail(null)
      setError(null)

      try {
        const detail = await getProject(projectId)
        if (!cancelled) setProjectDetail(detail)
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason : new Error('项目预览加载失败'))
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (error) {
    return (
      <PreviewState
        title='无法加载预览'
        detail={error.message}
        action={
          <Link className='text-xs text-[#67C6D9] hover:underline' to={`/projects/${projectId}/editor`}>
            返回编辑器
          </Link>
        }
      />
    )
  }

  if (!projectDetail) {
    return <PreviewState title='正在读取项目草稿…' />
  }

  return (
    <div className='relative min-h-screen bg-black'>
      <div className='fixed left-4 top-4 z-50 flex items-center gap-2'>
        <Button
          asChild
          variant='outline'
          size='sm'
          className='h-9 border-[#33404A] bg-[#0F1318]/92 text-[#E4E9EC] shadow-lg backdrop-blur hover:bg-[#182028] hover:text-white'
        >
          <Link to={`/projects/${projectId}/editor`}>
            <ArrowLeft className='size-4' />
            返回编辑器
          </Link>
        </Button>
        <span className='rounded-[6px] border border-[#2A333D] bg-[#0F1318]/88 px-2.5 py-1.5 text-xs text-[#8D99A3] backdrop-blur'>
          草稿预览
        </span>
      </div>
      <ProjectSchemaRenderer
        project={projectDetail}
        createDataSourceEngine={createDataSourceEngine as PreviewDataSourceEngine}
      />
    </div>
  )
}

export default function Preview() {
  const { projectId } = useParams<{ projectId: string }>()

  if (!projectId) {
    return <PreviewState title='项目地址无效' />
  }

  return <DraftProjectPreview projectId={projectId} />
}
