import { ApiError, apiRequest, jsonBody } from '@/api/client'
import type { AgentProjectWorkspacePayload, AgentWorkspaceRemoteRecord } from './types'

export type PutAgentWorkspaceInput = {
  expectedRevision?: number
  payload: AgentProjectWorkspacePayload
}

export type AgentWorkspaceRequest = <T>(path: string, init?: RequestInit) => Promise<T>

export class AgentWorkspaceRevisionConflictError extends Error {
  constructor() {
    super('Agent workspace revision changed')
    this.name = 'AgentWorkspaceRevisionConflictError'
  }
}

export function isAgentWorkspaceRevisionConflict(error: unknown): boolean {
  return error instanceof AgentWorkspaceRevisionConflictError
}

export async function getAgentProjectWorkspace(
  projectId: string,
  request: AgentWorkspaceRequest = apiRequest,
): Promise<AgentWorkspaceRemoteRecord | null> {
  const response = await request<{ workspace: AgentWorkspaceRemoteRecord | null }>(
    `/api/agent/workspace/${encodeURIComponent(projectId)}`,
  )
  return response.workspace
}

export async function putAgentProjectWorkspace(
  projectId: string,
  input: PutAgentWorkspaceInput,
  request: AgentWorkspaceRequest = apiRequest,
): Promise<AgentWorkspaceRemoteRecord> {
  try {
    const response = await request<{ workspace: AgentWorkspaceRemoteRecord }>(
      `/api/agent/workspace/${encodeURIComponent(projectId)}`,
      {
        method: 'PUT',
        body: jsonBody(input),
      },
    )
    return response.workspace
  } catch (error) {
    if (error instanceof ApiError && (error.status === 409 || error.code === 'AGENT_WORKSPACE_CONFLICT')) {
      throw new AgentWorkspaceRevisionConflictError()
    }
    throw error
  }
}
