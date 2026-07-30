import { useEditorSession } from '@/contexts/editor-session-context'
import { getProject } from '@/features/projects/project-api'
import { type ProjectSchema, TRANSFORM_STAGE, project } from '@easy-editor/core'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { decideAutoThumbnailRun, resolveThumbnailRetryAction } from './controller'
import { prepareCustomThumbnail } from './custom-image'
import { runAutoThumbnailPipeline } from './pipeline'
import { publishThumbnailArtifact, reconcileThumbnailArtifacts } from './project-thumbnail-api'
import {
  type ThumbnailState,
  createThumbnailState,
  failAutoThumbnail,
  queueAutoThumbnail,
  setCustomThumbnail,
} from './state'
import { mountThumbnailRenderer } from './thumbnail-renderer'

type EditorThumbnailValue = {
  state: ThumbnailState
  uploadCustomThumbnail(file: File): Promise<void>
  useCanvasThumbnail(): Promise<void>
  retry(): Promise<void>
}

const EditorThumbnailContext = createContext<EditorThumbnailValue | null>(null)

function thumbnailUrl(url: string, draftVersion: number): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${draftVersion}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '缩略图处理失败'
}

export function EditorThumbnailProvider({ children }: { children: ReactNode }) {
  const { flush, projectId, saveState } = useEditorSession()
  const [state, setState] = useState(() => createThumbnailState())
  const [seeded, setSeeded] = useState(false)
  const [canAutoRun, setCanAutoRun] = useState(false)
  const stateRef = useRef(state)
  const saveStateRef = useRef(saveState)
  const lastAttemptedVersionRef = useRef<number | null>(null)
  const lastCustomFileRef = useRef<File | null>(null)

  stateRef.current = state
  saveStateRef.current = saveState

  const writeState = useCallback((next: ThumbnailState) => {
    stateRef.current = next
    setState(next)
  }, [])

  useEffect(() => {
    let cancelled = false

    void reconcileThumbnailArtifacts(projectId)
      .catch(() => undefined)
      .then(() => getProject(projectId))
      .then(detail => {
        if (cancelled) return
        const seededState: ThumbnailState = {
          ...createThumbnailState({
            mode: detail.thumbnail.mode,
            imageUrl: detail.thumbnail.url,
            capturedVersion: detail.thumbnail.draftVersion,
          }),
          status: detail.thumbnail.status,
          error: detail.thumbnail.errorCode,
        }
        writeState(seededState)
        if (detail.thumbnail.status === 'ready') {
          lastAttemptedVersionRef.current = detail.thumbnail.draftVersion
        }
        setCanAutoRun(true)
      })
      .catch(error => {
        if (cancelled) return
        writeState({
          ...stateRef.current,
          status: 'failed',
          error: errorMessage(error),
        })
      })
      .finally(() => {
        if (!cancelled) setSeeded(true)
      })

    return () => {
      cancelled = true
    }
  }, [projectId, writeState])

  const runAuto = useCallback(
    async (draftVersion: number, force = false) => {
      const decision = decideAutoThumbnailRun({
        mode: stateRef.current.mode,
        saveStatus: saveStateRef.current.status,
        draftVersion,
        lastAttemptedVersion: lastAttemptedVersionRef.current,
        force,
      })
      if (!decision.run) return

      lastAttemptedVersionRef.current = decision.draftVersion
      writeState(queueAutoThumbnail(stateRef.current, decision.draftVersion))
      try {
        const projectDocument = project.export(TRANSFORM_STAGE.SAVE) as ProjectSchema
        await runAutoThumbnailPipeline(
          {
            projectDocument,
            draftVersion: decision.draftVersion,
          },
          {
            readState: () => stateRef.current,
            writeState,
            getCurrentDraftVersion: () => saveStateRef.current.version,
            mountPureRenderer: (container, document) =>
              mountThumbnailRenderer(container, document, decision.draftVersion),
            publish: async request => {
              const result = await publishThumbnailArtifact(projectId, {
                blob: request.blob,
                draftVersion: request.draftVersion,
                mode: 'auto',
                source: request.source,
                contentType: request.blob.type as 'image/webp' | 'image/svg+xml',
                size: request.blob.size,
                metadata: {
                  source: request.source,
                  width: request.width,
                  height: request.height,
                },
              })
              if (!result.url || result.draftVersion !== request.draftVersion) {
                throw new Error('缩略图完成响应缺少当前版本图片')
              }
              return thumbnailUrl(result.url, request.draftVersion)
            },
          },
        )
      } catch (error) {
        writeState(failAutoThumbnail(stateRef.current, decision.draftVersion, errorMessage(error)))
      }
    },
    [projectId, writeState],
  )

  useEffect(() => {
    if (!seeded || !canAutoRun) return
    const decision = decideAutoThumbnailRun({
      mode: state.mode,
      saveStatus: saveState.status,
      draftVersion: saveState.version,
      lastAttemptedVersion: lastAttemptedVersionRef.current,
    })
    if (!decision.run) return
    void runAuto(decision.draftVersion)
  }, [canAutoRun, runAuto, saveState.status, saveState.version, seeded, state.mode])

  const uploadCustomThumbnail = useCallback(
    async (file: File) => {
      lastCustomFileRef.current = file
      const snapshot = await flush()
      if (snapshot.status !== 'idle' && snapshot.status !== 'saved') {
        throw snapshot.error ?? new Error('请先完成草稿保存')
      }

      writeState({
        ...stateRef.current,
        mode: 'custom',
        status: 'rendering',
        requestedVersion: snapshot.version,
        error: null,
      })

      try {
        const prepared = await prepareCustomThumbnail(file)
        const result = await publishThumbnailArtifact(projectId, {
          blob: prepared.blob,
          draftVersion: snapshot.version,
          mode: 'custom',
          source: 'custom',
          contentType: 'image/webp',
          size: prepared.blob.size,
          metadata: {
            source: 'custom',
            originalWidth: prepared.metadata.width,
            originalHeight: prepared.metadata.height,
          },
        })
        if (
          saveStateRef.current.version !== snapshot.version ||
          !result.url ||
          result.draftVersion !== snapshot.version
        ) {
          throw new Error('自定义封面对应的草稿版本已变化')
        }
        const current = stateRef.current
        if (current.mode !== 'custom' || current.requestedVersion !== snapshot.version) {
          throw new Error('自定义封面请求已被新的操作替代')
        }
        writeState(setCustomThumbnail(current, thumbnailUrl(result.url, snapshot.version)))
      } catch (error) {
        const current = stateRef.current
        if (current.mode === 'custom' && current.requestedVersion === snapshot.version) {
          writeState({
            ...current,
            status: 'failed',
            imageUrl: current.lastGoodUrl,
            error: errorMessage(error),
          })
        }
        throw error
      }
    },
    [flush, projectId, writeState],
  )

  const useCanvasThumbnail = useCallback(async () => {
    const snapshot = await flush()
    if (snapshot.status !== 'idle' && snapshot.status !== 'saved') {
      throw snapshot.error ?? new Error('请先完成草稿保存')
    }
    writeState(queueAutoThumbnail({ ...stateRef.current, mode: 'auto' }, snapshot.version))
    await runAuto(snapshot.version, true)
  }, [flush, runAuto, writeState])

  const retry = useCallback(async () => {
    const action = resolveThumbnailRetryAction(stateRef.current.mode, lastCustomFileRef.current !== null)
    if (action === 'retry-custom' && lastCustomFileRef.current) {
      await uploadCustomThumbnail(lastCustomFileRef.current)
      return
    }
    if (action === 'select-custom-file') {
      throw new Error('请重新选择自定义封面文件')
    }
    await useCanvasThumbnail()
  }, [uploadCustomThumbnail, useCanvasThumbnail])

  const value = useMemo<EditorThumbnailValue>(
    () => ({
      state,
      uploadCustomThumbnail,
      useCanvasThumbnail,
      retry,
    }),
    [retry, state, uploadCustomThumbnail, useCanvasThumbnail],
  )

  return <EditorThumbnailContext.Provider value={value}>{children}</EditorThumbnailContext.Provider>
}

export function useEditorThumbnail(): EditorThumbnailValue {
  const context = useContext(EditorThumbnailContext)
  if (!context) throw new Error('useEditorThumbnail must be used within EditorThumbnailProvider')
  return context
}
