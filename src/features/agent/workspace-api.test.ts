import { ApiError } from '@/api/client'
import { describe, expect, it, vi } from 'vitest'
import type { AgentProjectWorkspacePayload, AgentWorkspaceRemoteRecord } from './types'
import {
  type AgentWorkspaceRequest,
  AgentWorkspaceRevisionConflictError,
  getAgentProjectWorkspace,
  putAgentProjectWorkspace,
} from './workspace-api'

const payload: AgentProjectWorkspacePayload = {
  version: 1,
  ownerUserId: 'user-a',
  projectId: 'project-a',
  conversations: [],
  projectContexts: [],
}

const record: AgentWorkspaceRemoteRecord = {
  ownerId: 'user-a',
  projectId: 'project-a',
  revision: 3,
  payload,
  createdAt: '2026-07-31T08:00:00.000Z',
  updatedAt: '2026-07-31T09:00:00.000Z',
}

describe('Agent workspace API', () => {
  it('uses the project-scoped GET and PUT contract', async () => {
    const request = vi.fn(async () => ({ workspace: record })) as unknown as AgentWorkspaceRequest

    await expect(getAgentProjectWorkspace('project/a', request)).resolves.toEqual(record)
    await expect(putAgentProjectWorkspace('project/a', { expectedRevision: 3, payload }, request)).resolves.toEqual(
      record,
    )

    expect(request).toHaveBeenNthCalledWith(1, '/api/agent/workspace/project%2Fa')
    expect(request).toHaveBeenNthCalledWith(2, '/api/agent/workspace/project%2Fa', {
      method: 'PUT',
      body: JSON.stringify({ expectedRevision: 3, payload }),
    })
  })

  it('maps the server CAS response to a dedicated conflict error', async () => {
    const request = vi.fn(async () => {
      throw new ApiError(409, { code: 'AGENT_WORKSPACE_CONFLICT', message: 'conflict' })
    }) as unknown as AgentWorkspaceRequest

    await expect(putAgentProjectWorkspace('project-a', { payload }, request)).rejects.toBeInstanceOf(
      AgentWorkspaceRevisionConflictError,
    )
  })
})
