import { describe, expect, it, vi } from 'vitest'

import { restoreProjectDraft } from './restore-draft'

describe('restoreProjectDraft', () => {
  it('replaces the whole editor project before accepting the restored server baseline', async () => {
    const events: string[] = []
    const schema = {
      version: '1.0.0',
      componentsTree: [{ componentName: 'Root', fileName: 'restored' }],
    }
    const restore = vi.fn(async () => ({
      draftVersion: 9,
      savedAt: '2026-07-30T09:00:00.000Z',
      updatedAt: '2026-07-30T09:00:00.000Z',
    }))
    const load = vi.fn(async () => ({ schema }))
    const reloadEditor = vi.fn(async () => {
      events.push('reload')
    })
    const acceptBaseline = vi.fn(() => {
      events.push('accept')
    })

    await restoreProjectDraft({
      projectId: 'project',
      revisionId: 'revision',
      expectedVersion: 8,
      restore,
      load,
      reloadEditor,
      acceptBaseline,
    })

    expect(restore).toHaveBeenCalledWith('project', 'revision', 8)
    expect(reloadEditor).toHaveBeenCalledWith(schema)
    expect(acceptBaseline).toHaveBeenCalledWith(9, '2026-07-30T09:00:00.000Z')
    expect(events).toEqual(['reload', 'accept'])
  })
})
