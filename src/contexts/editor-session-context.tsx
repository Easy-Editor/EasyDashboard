import type { ProjectRevision } from '@/api/contracts'
import { initializeEditorProject, teardownEditorProject } from '@/editor'
import { buildLocalDraftExport, getBlockedNavigationAction } from '@/editor/persistence/conflict-resolution'
import type { DraftSyncSnapshot } from '@/editor/persistence/draft-sync'
import { DraftSync } from '@/editor/persistence/draft-sync'
import { EDITOR_SAVE_REQUEST_EVENT } from '@/editor/persistence/editor-events'
import { shouldBlockEditorNavigation } from '@/editor/persistence/editor-navigation'
import { bindProjectMutations } from '@/editor/persistence/mutation-bridge'
import { restoreProjectDraft } from '@/editor/persistence/restore-draft'
import {
  createProjectRestorePoint,
  getProject,
  restoreProjectRevision,
  saveProjectDraft,
} from '@/features/projects/project-api'
import {
  type PublishedProjectRelease,
  type RestoredProjectReleaseDraft,
  publishProjectRelease,
  restoreProjectReleaseDraft,
} from '@/features/releases/release-api'
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
import { type BlockerFunction, Link, useBlocker } from 'react-router'
import { toast } from 'sonner'

type RestorePublishedReleaseOptions = {
  projectId: string
  releaseNumber: number
  flush: () => Promise<DraftSyncSnapshot>
  restore: (projectId: string, releaseNumber: number, expectedVersion: number) => Promise<RestoredProjectReleaseDraft>
  reloadEditor: (schema: ProjectSchema) => Promise<void>
  acceptBaseline: (version: number, savedAt: string) => void
  reportConflict: (error: unknown) => void
}

export class ReleaseRestoreReloadRequiredError extends Error {
  readonly draftVersion: number
  readonly savedAt: string

  constructor(draftVersion: number, savedAt: string, cause: unknown) {
    super('发布版本已恢复到服务端草稿，但编辑器载入失败。请刷新页面重新加载已恢复的草稿。', { cause })
    this.name = 'ReleaseRestoreReloadRequiredError'
    this.draftVersion = draftVersion
    this.savedAt = savedAt
  }
}

export async function restorePublishedRelease(options: RestorePublishedReleaseOptions) {
  const snapshot = await options.flush()
  try {
    const restored = await options.restore(options.projectId, options.releaseNumber, snapshot.version)
    try {
      await options.reloadEditor(restored.project.draftSchema)
    } catch (error) {
      throw new ReleaseRestoreReloadRequiredError(restored.project.draftVersion, restored.savedAt, error)
    }
    options.acceptBaseline(restored.project.draftVersion, restored.savedAt)
    return restored.project
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 409) {
      options.reportConflict(error)
    }
    throw error
  }
}

type EditorSessionValue = {
  projectId: string
  projectName: string
  projectSlug: string | null
  isPublished: boolean
  saveState: DraftSyncSnapshot
  conflictResolutionOpen: boolean
  openConflictResolution: () => void
  closeConflictResolution: () => void
  downloadLocalDraft: () => void
  reloadServerDraft: () => Promise<void>
  flush: () => Promise<DraftSyncSnapshot>
  publish: () => Promise<PublishedProjectRelease>
  createRestorePoint: () => Promise<ProjectRevision<ProjectSchema | undefined>>
  restoreRevision: (revisionId: string) => Promise<void>
  restoreRelease: (releaseNumber: number) => Promise<void>
}

const EditorSessionContext = createContext<EditorSessionValue | null>(null)

function EditorSessionReady({
  projectId,
  projectName,
  projectSlug,
  isPublished,
  draftVersion,
  draftSavedAt,
  autoSave,
  children,
}: {
  projectId: string
  projectName: string
  projectSlug: string | null
  isPublished: boolean
  draftVersion: number
  draftSavedAt: string
  autoSave: boolean
  children: ReactNode
}) {
  const [sync] = useState(
    () =>
      new DraftSync<ProjectSchema>({
        initialVersion: draftVersion,
        initialSavedAt: draftSavedAt,
        autoSave,
        exportSchema: () => project.export(TRANSFORM_STAGE.SAVE),
        save: (schema, expectedVersion) => saveProjectDraft(projectId, schema, expectedVersion),
      }),
  )
  const saveState = useSyncExternalStore(sync.subscribe, sync.getSnapshot)
  const [conflictResolutionOpen, setConflictResolutionOpen] = useState(false)

  const flush = useCallback(async () => {
    await sync.flush()
    const snapshot = sync.getSnapshot()
    if ((snapshot.status === 'error' || snapshot.status === 'conflict') && snapshot.error) {
      throw snapshot.error
    }
    return snapshot
  }, [sync])

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => shouldBlockEditorNavigation(saveState.status, currentLocation, nextLocation),
    [saveState.status],
  )
  const blocker = useBlocker(shouldBlock)

  useEffect(() => {
    const unbindMutations = bindProjectMutations(project, sync.markDirty)

    return () => {
      unbindMutations()
      void sync.flushAndDispose()
    }
  }, [sync])

  useEffect(() => {
    if (blocker.state !== 'blocked') return

    if (getBlockedNavigationAction(saveState.status) === 'resolve-conflict') {
      blocker.reset()
      setConflictResolutionOpen(true)
      return
    }

    let active = true
    const { proceed, reset } = blocker

    void flush()
      .then(() => {
        if (active) proceed()
      })
      .catch(error => {
        if (!active) return
        reset()
        if (sync.getSnapshot().status === 'conflict') {
          setConflictResolutionOpen(true)
          toast.error('检测到草稿版本冲突，已保留当前本地修改')
        } else {
          toast.error('草稿保存失败，已留在编辑器', {
            description: error instanceof Error ? error.message : '请检查网络后重试',
          })
        }
      })

    return () => {
      active = false
    }
  }, [blocker, flush, saveState.status, sync])

  const downloadLocalDraft = useCallback(() => {
    const schema = sync.getConflictSchema()
    if (!schema) {
      toast.error('没有可导出的本地冲突副本')
      return
    }
    const backup = buildLocalDraftExport(schema, projectName)
    const url = URL.createObjectURL(new Blob([backup.content], { type: 'application/json;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = backup.filename
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success('本地草稿副本已下载')
  }, [projectName, sync])

  const reloadServerDraft = useCallback(async () => {
    const detail = await getProject(projectId)
    await initializeEditorProject(detail.schema)
    sync.acceptReloadedVersion(detail.draftVersion, detail.savedAt)
    setConflictResolutionOpen(false)
    toast.success('已重新加载服务端草稿', {
      description: '当前内存中的冲突修改已明确丢弃',
    })
  }, [projectId, sync])

  const publish = useCallback(async () => {
    const snapshot = await flush()
    try {
      return await publishProjectRelease(projectId, snapshot.version)
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 409) {
        sync.reportConflict(error)
      }
      throw error
    }
  }, [flush, projectId, sync])

  const createRestorePoint = useCallback(async () => {
    await flush()
    return createProjectRestorePoint(projectId)
  }, [flush, projectId])

  const restoreRevision = useCallback(
    async (revisionId: string) => {
      const snapshot = await flush()
      try {
        await restoreProjectDraft({
          projectId,
          revisionId,
          expectedVersion: snapshot.version,
          restore: restoreProjectRevision,
          load: getProject,
          reloadEditor: initializeEditorProject,
          acceptBaseline: sync.acceptReloadedVersion,
        })
      } catch (error) {
        if (error instanceof Error && 'status' in error && error.status === 409) {
          sync.reportConflict(error)
        }
        throw error
      }
    },
    [flush, projectId, sync],
  )

  const restoreRelease = useCallback(
    async (releaseNumber: number) => {
      await restorePublishedRelease({
        projectId,
        releaseNumber,
        flush,
        restore: restoreProjectReleaseDraft,
        reloadEditor: initializeEditorProject,
        acceptBaseline: sync.acceptReloadedVersion,
        reportConflict: sync.reportConflict,
      })
    },
    [flush, projectId, sync],
  )

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
      conflictResolutionOpen,
      openConflictResolution: () => setConflictResolutionOpen(true),
      closeConflictResolution: () => setConflictResolutionOpen(false),
      downloadLocalDraft,
      reloadServerDraft,
      flush,
      publish,
      createRestorePoint,
      restoreRevision,
      restoreRelease,
    }),
    [
      conflictResolutionOpen,
      createRestorePoint,
      downloadLocalDraft,
      flush,
      isPublished,
      projectId,
      projectName,
      projectSlug,
      publish,
      reloadServerDraft,
      restoreRelease,
      restoreRevision,
      saveState,
    ],
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
    draftSavedAt: string
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
            draftSavedAt: detail.savedAt,
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
      draftSavedAt={session.draftSavedAt}
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
