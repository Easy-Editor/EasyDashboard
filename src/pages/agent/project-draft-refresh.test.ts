import { describe, expect, it, vi } from 'vitest'
import { refreshProjectDraftAfterMutation } from './project-draft-refresh'

describe('refreshProjectDraftAfterMutation', () => {
  it('applies the latest project and broadcasts its committed draft version', async () => {
    const project = { id: 'project-a', draftVersion: 21 }
    const loadProject = vi.fn().mockResolvedValue(project)
    const applyProject = vi.fn()
    const publishUpdate = vi.fn()

    await expect(
      refreshProjectDraftAfterMutation({
        projectId: project.id,
        loadProject,
        applyProject,
        publishUpdate,
      }),
    ).resolves.toEqual({ ok: true, project })

    expect(loadProject).toHaveBeenCalledWith(project.id)
    expect(applyProject).toHaveBeenCalledWith(project)
    expect(publishUpdate).toHaveBeenCalledWith({ projectId: project.id, draftVersion: 21 })
  })

  it('reports refresh failures without throwing after the document mutation already succeeded', async () => {
    const reason = new Error('network unavailable')
    const applyProject = vi.fn()
    const publishUpdate = vi.fn()

    await expect(
      refreshProjectDraftAfterMutation({
        projectId: 'project-a',
        loadProject: vi.fn().mockRejectedValue(reason),
        applyProject,
        publishUpdate,
      }),
    ).resolves.toEqual({ ok: false, reason })

    expect(applyProject).not.toHaveBeenCalled()
    expect(publishUpdate).not.toHaveBeenCalled()
  })
})
