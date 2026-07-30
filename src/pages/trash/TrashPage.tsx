import { ProjectCard, type ProjectCardProject } from '@/components/project/ProjectCard'
import { Button } from '@/components/ui/button'
import { listProjects, restoreProject } from '@/features/projects/project-api'
import { PageFrame } from '@/layouts/PageFrame'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

export function TrashPage() {
  const [projects, setProjects] = useState<ProjectCardProject[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setMessage(null)
    try {
      const response = await listProjects('trash')
      setProjects(response.projects)
    } catch {
      setMessage('回收站加载失败，请稍后重试')
      setProjects([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleRestore(project: ProjectCardProject) {
    setMessage(null)
    try {
      await restoreProject(project.id)
      setProjects(current => current?.filter(item => item.id !== project.id) ?? [])
      setMessage(`“${project.name}”已恢复`)
    } catch {
      setMessage('项目恢复失败，请稍后重试')
    }
  }

  return (
    <PageFrame
      eyebrow='Workspace / Trash'
      title='回收站'
      description='恢复已移除的项目。'
      action={
        projects && projects.length > 0 ? (
          <span className='font-mono text-[10px] text-[var(--ed-ink-faint)]'>{projects.length} 个项目</span>
        ) : undefined
      }
    >
      {message ? (
        <output className='mt-5 block border-l-2 border-[var(--ed-cyan)] bg-[var(--ed-panel)] px-4 py-2.5 text-xs text-[var(--ed-ink-soft)]'>
          {message}
        </output>
      ) : null}

      {projects === null ? (
        <div className='mt-6 grid grid-cols-[repeat(auto-fill,minmax(260px,304px))] gap-5'>
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className='aspect-[1.15] animate-pulse rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel)]'
            />
          ))}
        </div>
      ) : projects.length > 0 ? (
        <div className='mt-6 grid grid-cols-[repeat(auto-fill,minmax(260px,304px))] gap-5'>
          {projects.map(project => (
            <ProjectCard key={project.id} project={project} onRestore={item => void handleRestore(item)} />
          ))}
        </div>
      ) : (
        <div className='mx-auto mt-20 max-w-[390px] text-center'>
          <div className='ed-trash-empty mx-auto grid aspect-video w-[320px] place-items-center rounded-[8px] border border-[var(--ed-line-strong)] bg-[#080d15]'>
            <Trash2 className='size-6 text-[#5f7487]' />
          </div>
          <h2 className='mt-6 font-[var(--font-display)] text-lg font-medium text-[var(--ed-ink)]'>回收站是空的</h2>
          <p className='mt-2 text-xs leading-5 text-[var(--ed-ink-muted)]'>移除的项目会暂时保留在这里，便于恢复。</p>
          <Button
            type='button'
            variant='outline'
            onClick={() => void load()}
            className='mt-5 h-8 rounded-[6px] border-[var(--ed-line-strong)] bg-transparent text-xs'
          >
            <RotateCcw />
            刷新
          </Button>
        </div>
      )}
    </PageFrame>
  )
}
