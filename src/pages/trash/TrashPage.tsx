import { ApiError } from '@/api/client'
import { ProjectCard, type ProjectCardProject } from '@/components/project/ProjectCard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deleteProjectPermanently, listProjects, restoreProject } from '@/features/projects/project-api'
import { PageFrame } from '@/layouts/PageFrame'
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'

export function isPermanentDeleteConfirmationValid(projectName: string, confirmation: string): boolean {
  return confirmation === projectName
}

export function TrashPage() {
  const [projects, setProjects] = useState<ProjectCardProject[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectCardProject | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setMessage(null)
    setLoadError(null)
    setProjects(null)
    try {
      const response = await listProjects('trash')
      setProjects(response.projects)
    } catch (reason) {
      setLoadError(reason instanceof ApiError ? reason.message : '回收站加载失败，请稍后重试')
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

  function openPermanentDeleteDialog(project: ProjectCardProject) {
    setDeleteTarget(project)
    setDeleteConfirmation('')
    setDeleteError(null)
  }

  function closePermanentDeleteDialog() {
    setDeleteTarget(null)
    setDeleteConfirmation('')
    setDeleteError(null)
  }

  async function handlePermanentDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!deleteTarget || deleting || !isPermanentDeleteConfirmationValid(deleteTarget.name, deleteConfirmation)) {
      return
    }

    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteProjectPermanently(deleteTarget.id)
      setProjects(current => current?.filter(project => project.id !== deleteTarget.id) ?? [])
      setMessage(`“${deleteTarget.name}”已永久删除`)
      closePermanentDeleteDialog()
    } catch (reason) {
      const detail = reason instanceof ApiError ? `：${reason.message}` : ''
      setDeleteError(`永久删除失败${detail}。项目仍保留在回收站中。`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageFrame
        title='回收站'
        description='恢复已移除的项目，或永久清理不再需要的内容。'
        action={
          projects && projects.length > 0 ? (
            <span className='font-mono text-[11px] text-[var(--ed-ink-faint)]'>{projects.length} 个项目</span>
          ) : undefined
        }
      >
        {message ? (
          <output
            aria-live='polite'
            className='mt-5 block border-l-2 border-[var(--ed-cyan)] bg-[var(--ed-panel)] px-4 py-2.5 text-xs text-[var(--ed-ink-soft)]'
          >
            {message}
          </output>
        ) : null}

        {loadError ? (
          <div className='mt-6 flex items-center justify-between gap-4 border-l-2 border-[#ff7f8a] bg-[#35161d]/45 px-4 py-3'>
            <p role='alert' className='text-xs text-[#ffabb2]'>
              {loadError}
            </p>
            <Button
              type='button'
              variant='outline'
              onClick={() => void load()}
              className='h-8 rounded-[6px] border-[#67404a] bg-transparent text-xs text-[#ffc3c8]'
            >
              <RotateCcw />
              重试
            </Button>
          </div>
        ) : projects === null ? (
          <div className='mt-6 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5'>
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className='aspect-[1.15] animate-pulse rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel)]'
              />
            ))}
          </div>
        ) : projects.length > 0 ? (
          <div className='mt-6 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5'>
            {projects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                onRestore={item => void handleRestore(item)}
                onDeletePermanently={openPermanentDeleteDialog}
              />
            ))}
          </div>
        ) : (
          <div className='grid min-h-[calc(100vh-220px)] place-items-center py-12 text-center'>
            <div className='w-full max-w-[390px]'>
              <div className='ed-trash-empty mx-auto grid aspect-video w-full max-w-[320px] place-items-center rounded-[8px] border border-[var(--ed-line-strong)] bg-[#080d15]'>
                <Trash2 className='size-6 text-[#5f7487]' />
              </div>
              <h2 className='mt-6 font-[var(--font-display)] text-lg font-medium text-[var(--ed-ink)]'>回收站是空的</h2>
              <p className='mt-2 text-xs leading-5 text-[var(--ed-ink-muted)]'>
                移除的项目会暂时保留在这里，便于恢复。
              </p>
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
          </div>
        )}
      </PageFrame>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={open => {
          if (!open && !deleting) closePermanentDeleteDialog()
        }}
      >
        <DialogContent className='rounded-[12px] border-[#67404a] bg-[var(--ed-panel-raised)] text-[var(--ed-ink)] shadow-2xl'>
          <DialogHeader>
            <div className='mb-2 grid size-9 place-items-center rounded-[8px] border border-[#67404a] bg-[#35161d]/70'>
              <AlertTriangle className='size-4 text-[#ff9ca5]' />
            </div>
            <DialogTitle className='font-[var(--font-display)] text-lg'>永久删除“{deleteTarget?.name}”？</DialogTitle>
            <DialogDescription className='text-xs leading-6 text-[var(--ed-ink-muted)]'>
              此操作无法撤销。项目内的所有页面、保存记录、发布版本、公开链接和缩略图都将永久删除。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handlePermanentDelete} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='permanent-delete-confirmation' className='text-xs text-[var(--ed-ink-soft)]'>
                输入项目名称“{deleteTarget?.name}”确认
              </Label>
              <Input
                id='permanent-delete-confirmation'
                value={deleteConfirmation}
                onChange={event => setDeleteConfirmation(event.target.value)}
                disabled={deleting}
                autoComplete='off'
                autoFocus
                className='rounded-[8px] border-[#67404a] bg-[var(--ed-panel)] focus-visible:border-[#ff7f8a] focus-visible:ring-[#ff7f8a]/25'
              />
            </div>
            {deleteError ? (
              <p role='alert' className='border-l-2 border-[#ff7f8a] pl-3 text-xs leading-5 text-[#ffabb2]'>
                {deleteError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={closePermanentDeleteDialog}
                disabled={deleting}
                className='rounded-[8px] border-[var(--ed-line-strong)] bg-transparent'
              >
                取消
              </Button>
              <Button
                type='submit'
                disabled={
                  deleting ||
                  !deleteTarget ||
                  !isPermanentDeleteConfirmationValid(deleteTarget.name, deleteConfirmation)
                }
                className='rounded-[8px] border border-[#8c3e49] bg-[#5a2029] text-[#ffe8ea] hover:bg-[#762a36]'
              >
                {deleting ? '正在永久删除…' : '永久删除'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
