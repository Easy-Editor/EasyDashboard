import type { PublishResponse } from '@/api/contracts'
import { initializeEditorProject, teardownEditorProject } from '@/editor'
import type { DraftSyncSnapshot } from '@/editor/persistence/draft-sync'
import { DraftSync } from '@/editor/persistence/draft-sync'
import { EDITOR_SAVE_REQUEST_EVENT } from '@/editor/persistence/editor-events'
import { bindProjectMutations } from '@/editor/persistence/mutation-bridge'
import { getProject, publishProject, saveProjectDraft } from '@/features/projects/project-api'
import { getSettings } from '@/features/settings/settings-api'
import { type ProjectSchema, TRANSFORM_STAGE, project } from '@easy-editor/core'
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { Link, useBlocker } from 'react-router'
import { toast } from 'sonner'

type EditorSessionValue = {
  projectId: string
  projectName: string
  projectSlug: string | null
  isPublished: boolean
  saveState: DraftSyncSnapshot
  flush: () => Promise<DraftSyncSnapshot>
  publish: () => Promise<PublishResponse>
}

const EditorSessionContext = createContext<EditorSessionValue | null>(null)

function EditorSessionReady({
  projectId,
  projectName,
  projectSlug,
  isPublished,
  draftVersion,
  autoSave,
  children,
}: {
  projectId: string
  projectName: string
  projectSlug: string | null
  isPublished: boolean
  draftVersion: number
  autoSave: boolean
  children: ReactNode
}) {
  const [sync] = useState(
    () =>
      new DraftSync<ProjectSchema>({
        initialVersion: draftVersion,
        autoSave,
        exportSchema: () => project.export(TRANSFORM_STAGE.SAVE),
        save: (schema, expectedVersion) => saveProjectDraft(projectId, schema, expectedVersion),
      }),
  )
  const saveState = useSyncExternalStore(sync.subscribe, sync.getSnapshot)

  const flush = useCallback(async () => {
    await sync.flush()
    const snapshot = sync.getSnapshot()
    if ((snapshot.status === 'error' || snapshot.status === 'conflict') && snapshot.error) {
      throw snapshot.error
    }
    return snapshot
  }, [sync])

  const blocker = useBlocker(['dirty', 'saving', 'error', 'conflict'].includes(saveState.status))

  useEffect(() => {
    const unbindMutations = bindProjectMutations(project, sync.markDirty)

    return () => {
      unbindMutations()
      void sync.flushAndDispose()
    }
  }, [sync])

  useEffect(() => {
    if (blocker.state !== 'blocked') return

    let active = true
    const { proceed, reset } = blocker

    void flush()
      .then(() => {
        if (active) proceed()
      })
      .catch(error => {
        if (!active) return
        reset()
        toast.error('草稿保存失败，已留在编辑器', {
          description: error instanceof Error ? error.message : '请检查网络后重试',
        })
      })

    return () => {
      active = false
    }
  }, [blocker, flush])

  const publish = useCallback(async () => {
    const snapshot = await flush()
    try {
      return await publishProject(projectId, snapshot.version)
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 409) {
        sync.reportConflict(error)
      }
      throw error
    }
  }, [flush, projectId, sync])

  useEffect(() => {
    const handleSaveRequest = () => {
      void flush().catch(() => undefined)
    }

    window.addEventListener(EDITOR_SAVE_REQUEST_EVENT, handleSaveRequest)
    return () => window.removeEventListener(EDITOR_SAVE_REQUEST_EVENT, handleSaveRequest)
  }, [flush])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!['dirty', 'saving', 'error', 'conflict'].includes(sync.getSnapshot().status)) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [sync])

  const value = useMemo<EditorSessionValue>(
    () => ({
      projectId,
      projectName,
      projectSlug,
      isPublished,
      saveState,
      flush,
      publish,
    }),
    [flush, isPublished, projectId, projectName, projectSlug, publish, saveState],
  )

  return <EditorSessionContext.Provider value={value}>{children}</EditorSessionContext.Provider>
}

export function EditorSessionProvider({
  projectId,
  children,
}: {
  projectId: string
  children: ReactNode
}) {
  const [session, setSession] = useState<{
    projectName: string
    projectSlug: string | null
    isPublished: boolean
    draftVersion: number
    autoSave: boolean
  } | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      setSession(null)
      setError(null)

      try {
        const [detail, settings] = await Promise.all([
          getProject(projectId),
          getSettings().catch(() => ({ autosave: true })),
        ])
        if (cancelled) return
        await initializeEditorProject(detail.schema)
        if (!cancelled) {
          setSession({
            projectName: detail.name,
            projectSlug: detail.slug,
            isPublished: detail.state === 'published',
            draftVersion: detail.draftVersion,
            autoSave: settings.autosave !== false,
          })
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason : new Error('项目加载失败'))
        }
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
      void teardownEditorProject()
    }
  }, [projectId])

  if (error) {
    return (
      <div className='grid min-h-screen place-items-center bg-[#080A0D] p-6 text-[#F1F5F7]'>
        <div className='max-w-md border border-[#2A333D] bg-[#0F1318] p-6'>
          <p className='text-xs uppercase tracking-[0.2em] text-[#67C6D9]'>项目加载失败</p>
          <h1 className='mt-3 text-xl font-semibold'>无法打开项目</h1>
          <p className='mt-2 text-sm text-[#8D99A3]'>{error.message}</p>
          <Link className='mt-6 inline-flex text-sm text-[#67C6D9] hover:underline' to='/projects'>
            返回项目列表
          </Link>
        </div>
      </div>
    )
  }

  if (!session) {
    return <div className='grid min-h-screen place-items-center bg-[#080A0D] text-sm text-[#8D99A3]'>正在加载项目…</div>
  }

  return (
    <EditorSessionReady
      projectId={projectId}
      projectName={session.projectName}
      projectSlug={session.projectSlug}
      isPublished={session.isPublished}
      draftVersion={session.draftVersion}
      autoSave={session.autoSave}
    >
      {children}
    </EditorSessionReady>
  )
}

export function useEditorSession() {
  const context = useContext(EditorSessionContext)
  if (!context) {
    throw new Error('useEditorSession must be used within EditorSessionProvider')
  }
  return context
}
