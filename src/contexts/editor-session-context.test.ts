import type { DraftSyncSnapshot } from '@/editor/persistence/draft-sync'
import type { ProjectSchema } from '@easy-editor/core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/editor', () => ({
  initializeEditorProject: vi.fn(),
  teardownEditorProject: vi.fn(),
}))

vi.mock('@easy-editor/core', () => ({
  TRANSFORM_STAGE: { SAVE: 'save' },
  project: {
    export: vi.fn(),
  },
}))

import { ReleaseRestoreReloadRequiredError, restorePublishedRelease } from './editor-session-context'

const schema = {
  version: '1.0.0',
  componentsTree: [],
} as ProjectSchema

function savedSnapshot(version: number): DraftSyncSnapshot {
  return {
    status: 'saved',
    version,
    savedAt: '2026-07-30T05:00:00.000Z',
    error: null,
  }
}

describe('restorePublishedRelease', () => {
  it('applies the committed restore response directly without loading the project again', async () => {
    const calls: string[] = []
    const flush = vi.fn(async () => {
      calls.push('flush')
      return savedSnapshot(11)
    })
    const restore = vi.fn(async () => {
      calls.push('restore')
      return {
        project: {
          draftSchema: schema,
          draftVersion: 12,
        },
        savedAt: '2026-07-30T06:00:00.000Z',
      }
    })
    const reloadEditor = vi.fn(async () => {
      calls.push('reload')
    })
    const acceptBaseline = vi.fn(() => {
      calls.push('accept')
    })

    await expect(
      restorePublishedRelease({
        projectId: 'project-1',
        releaseNumber: 4,
        flush,
        restore,
        reloadEditor,
        acceptBaseline,
        reportConflict: vi.fn(),
      }),
    ).resolves.toEqual({
      draftSchema: schema,
      draftVersion: 12,
    })

    expect(calls).toEqual(['flush', 'restore', 'reload', 'accept'])
    expect(restore).toHaveBeenCalledWith('project-1', 4, 11)
    expect(reloadEditor).toHaveBeenCalledWith(schema)
    expect(acceptBaseline).toHaveBeenCalledWith(12, '2026-07-30T06:00:00.000Z')
  })

  it('reports that the server restore committed when local editor initialization fails', async () => {
    const initializationFailure = new Error('renderer initialization failed')
    const acceptBaseline = vi.fn()

    const promise = restorePublishedRelease({
      projectId: 'project-1',
      releaseNumber: 4,
      flush: vi.fn(async () => savedSnapshot(11)),
      restore: vi.fn(async () => ({
        project: {
          draftSchema: schema,
          draftVersion: 12,
        },
        savedAt: '2026-07-30T06:00:00.000Z',
      })),
      reloadEditor: vi.fn(async () => {
        throw initializationFailure
      }),
      acceptBaseline,
      reportConflict: vi.fn(),
    })

    await expect(promise).rejects.toMatchObject({
      name: 'ReleaseRestoreReloadRequiredError',
      draftVersion: 12,
      savedAt: '2026-07-30T06:00:00.000Z',
      cause: initializationFailure,
    })
    await expect(promise).rejects.toBeInstanceOf(ReleaseRestoreReloadRequiredError)
    await expect(promise).rejects.toThrow('发布版本已恢复到服务端草稿')
    expect(acceptBaseline).not.toHaveBeenCalled()
  })

  it('reports a 409 as an editor draft conflict and does not replace the document', async () => {
    const conflict = Object.assign(new Error('草稿版本冲突'), { status: 409 })
    const reportConflict = vi.fn()
    const reloadEditor = vi.fn()
    const acceptBaseline = vi.fn()

    await expect(
      restorePublishedRelease({
        projectId: 'project-1',
        releaseNumber: 4,
        flush: vi.fn(async () => savedSnapshot(11)),
        restore: vi.fn(async () => {
          throw conflict
        }),
        reloadEditor,
        acceptBaseline,
        reportConflict,
      }),
    ).rejects.toBe(conflict)

    expect(reportConflict).toHaveBeenCalledWith(conflict)
    expect(reloadEditor).not.toHaveBeenCalled()
    expect(acceptBaseline).not.toHaveBeenCalled()
  })
})
