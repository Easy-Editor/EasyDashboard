import { ApiError } from '@/api/client'
import { describe, expect, it, vi } from 'vitest'
import {
  SharedProjectContextConflictError,
  type SharedProjectContextRequest,
  deleteSharedProjectContext,
  listSharedProjectContexts,
  rollbackSharedProjectContext,
  saveSharedProjectContext,
} from './project-context-api'
import type { AgentProjectContext } from './types'

const context: AgentProjectContext = {
  id: 'context-1',
  projectId: 'project-1',
  title: '视觉约束',
  content: '保持深色主题',
  status: 'confirmed',
  revision: 3,
  history: [],
  sourceTaskId: 'task-1',
  provenance: { origin: 'agent_task', sourceKinds: ['user_request', 'agent_result'] },
  createdAt: '2026-07-31T08:00:00.000Z',
  updatedAt: '2026-07-31T09:00:00.000Z',
  confirmedAt: '2026-07-31T08:00:00.000Z',
}

describe('shared project context API', () => {
  it('uses project-scoped list and confirmed save contracts', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ contexts: [context] })
      .mockResolvedValueOnce({ context }) as unknown as SharedProjectContextRequest

    await expect(listSharedProjectContexts('project/a', request)).resolves.toEqual([context])
    await expect(
      saveSharedProjectContext(
        'project/a',
        {
          id: context.id,
          expectedRevision: 2,
          title: context.title,
          content: context.content,
          sourceTaskId: context.sourceTaskId,
          provenance: context.provenance,
        },
        request,
      ),
    ).resolves.toEqual(context)

    expect(request).toHaveBeenNthCalledWith(1, '/api/projects/project%2Fa/agent/contexts')
    expect(request).toHaveBeenNthCalledWith(2, '/api/projects/project%2Fa/agent/contexts', {
      method: 'PUT',
      body: JSON.stringify({
        id: context.id,
        expectedRevision: 2,
        title: context.title,
        content: context.content,
        sourceTaskId: 'task-1',
        provenance: { origin: 'agent_task', sourceKinds: ['user_request', 'agent_result'] },
        status: 'confirmed',
      }),
    })
  })

  it('uses CAS rollback and delete contracts', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ context })
      .mockResolvedValueOnce(undefined) as unknown as SharedProjectContextRequest

    await expect(
      rollbackSharedProjectContext('project-1', context.id, { expectedRevision: 3, targetRevision: 1 }, request),
    ).resolves.toEqual(context)
    await expect(deleteSharedProjectContext('project-1', context.id, 4, request)).resolves.toBeUndefined()

    expect(request).toHaveBeenNthCalledWith(1, '/api/projects/project-1/agent/contexts/context-1/rollback', {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: 3, targetRevision: 1 }),
    })
    expect(request).toHaveBeenNthCalledWith(2, '/api/projects/project-1/agent/contexts/context-1', {
      method: 'DELETE',
      body: JSON.stringify({ expectedRevision: 4 }),
    })
  })

  it('maps server CAS conflicts to a dedicated error', async () => {
    const request = vi.fn(async () => {
      throw new ApiError(409, { code: 'PROJECT_CONTEXT_CONFLICT', message: 'conflict' })
    }) as unknown as SharedProjectContextRequest

    await expect(
      saveSharedProjectContext('project-1', { title: '标题', content: '内容' }, request),
    ).rejects.toBeInstanceOf(SharedProjectContextConflictError)
  })
})
