import { Button } from '@/components/ui/button'
import { useEditorSession } from '@/contexts/editor-session-context'
import { getPublishedProjectUrl } from '@/features/projects/public-viewer'
import { cn } from '@/lib/utils'
import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { EditorModeTabs } from './EditorModeTabs'
import { HistoryButtons } from './HistoryButtons'
import { MainNav } from './Nav'

export function AppHeader({ className }: { className?: string }) {
  const { flush, projectId, projectName, projectSlug, publish: publishProject, saveState } = useEditorSession()
  const [publishedSlug, setPublishedSlug] = useState<string | null>(projectSlug)

  useEffect(() => {
    setPublishedSlug(projectSlug)
  }, [projectSlug])

  const publishedHref = publishedSlug ? getPublishedProjectUrl(publishedSlug) : null

  const save = async () => {
    try {
      await flush()
      toast.success('草稿已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存项目失败')
    }
  }

  const preview = async () => {
    const previewWindow = window.open('', '_blank')
    try {
      await flush()
      const href = `/projects/${encodeURIComponent(projectId)}/preview`
      if (previewWindow) {
        previewWindow.location.href = href
      } else {
        window.location.href = href
      }
    } catch (error) {
      previewWindow?.close()
      toast.error(error instanceof Error ? error.message : '保存项目失败，无法预览')
    }
  }

  const publish = async () => {
    try {
      const publication = await publishProject()
      setPublishedSlug(publication.slug)
      const href = getPublishedProjectUrl(publication.slug)
      if (!href) {
        toast.success('发布成功', {
          description: '公开页面已更新，但当前没有可用的公开访问地址',
        })
        return
      }
      toast.success('发布成功', {
        description: '公开页面已更新',
        action: {
          label: '查看发布页',
          onClick: () => window.open(href, '_blank', 'noopener,noreferrer'),
        },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发布失败')
    }
  }

  const saveLabel = {
    idle: '已保存',
    dirty: '有未保存更改',
    saving: '保存中…',
    saved: '已保存',
    error: '保存失败',
    conflict: '版本冲突',
  }[saveState.status]

  return (
    <header
      className={cn(
        'h-[57px] w-full',
        'bg-background/80 backdrop-blur-xl',
        'border-b border-border/60',
        'sticky top-0 z-50',
        'transition-all duration-200',
        className,
      )}
    >
      <div className='grid h-full w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2 sm:gap-3 sm:px-4'>
        <MainNav projectName={projectName} saveStatus={saveLabel} />
        <div className='min-w-0'>
          <EditorModeTabs />
        </div>
        <div className='flex min-w-0 items-center justify-end gap-1.5'>
          <div className='hidden xl:block'>
            <HistoryButtons />
          </div>
          <div className='hidden h-4 w-px bg-border/60 xl:block' />
          <Button
            variant='ghost'
            size='sm'
            className='hidden h-8 gap-2 text-[#B7C3CB] hover:bg-[#171D24] hover:text-white lg:inline-flex'
            onClick={() => void preview()}
          >
            预览草稿
          </Button>
          {publishedHref ? (
            <>
              <Button
                asChild
                variant='ghost'
                size='icon'
                className='size-8 text-[#B7C3CB] hover:bg-[#171D24] hover:text-white lg:hidden'
              >
                <a href={publishedHref} target='_blank' rel='noreferrer' aria-label='查看发布页'>
                  <ExternalLink className='size-4' />
                </a>
              </Button>
              <Button
                asChild
                variant='ghost'
                size='sm'
                className='hidden h-8 gap-1.5 text-[#B7C3CB] hover:bg-[#171D24] hover:text-white lg:inline-flex'
              >
                <a href={publishedHref} target='_blank' rel='noreferrer'>
                  查看发布页
                  <ExternalLink className='size-3.5' />
                </a>
              </Button>
            </>
          ) : null}
          <Button
            size='sm'
            variant='outline'
            className='hidden h-8 gap-2 xl:inline-flex'
            disabled={saveState.status === 'saving'}
            onClick={() => void save()}
          >
            保存
          </Button>
          <Button
            size='sm'
            className='h-8 gap-2 bg-[#F1F5F7] text-[#080A0D] hover:bg-white'
            disabled={saveState.status === 'saving' || saveState.status === 'conflict'}
            onClick={() => void publish()}
          >
            {publishedSlug ? '发布更新' : '发布'}
          </Button>
        </div>
      </div>
    </header>
  )
}
