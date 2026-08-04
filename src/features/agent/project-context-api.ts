import { ApiError, apiRequest, jsonBody } from '@/api/client'
import type { AgentProjectContext, AgentProjectContextProvenance } from './types'

export type SharedProjectContextRequest = <T>(path: string, init?: RequestInit) => Promise<T>

export type SaveSharedProjectContextInput = {
  id?: string
  expectedRevision?: number
  title: string
  content: string
  sourceTaskId?: string
  provenance?: AgentProjectContextProvenance
}

export class SharedProjectContextConflictError extends Error {
  constructor() {
    super('Project context revision changed')
    this.name = 'SharedProjectContextConflictError'
  }
}

export function isSharedProjectContextConflict(error: unknown): boolean {
  return error instanceof SharedProjectContextConflictError
}

function mapConflict(error: unknown): never {
  if (error instanceof ApiError && (error.status === 409 || error.code === 'PROJECT_CONTEXT_CONFLICT')) {
    throw new SharedProjectContextConflictError()
  }
  throw error
}

export async function listSharedProjectContexts(
  projectId: string,
  request: SharedProjectContextRequest = apiRequest,
): Promise<AgentProjectContext[]> {
  const response = await request<{ contexts: AgentProjectContext[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/agent/contexts`,
  )
  return response.contexts
}

export async function saveSharedProjectContext(
  projectId: string,
  input: SaveSharedProjectContextInput,
  request: SharedProjectContextRequest = apiRequest,
): Promise<AgentProjectContext> {
  try {
    const response = await request<{ context: AgentProjectContext }>(
      `/api/projects/${encodeURIComponent(projectId)}/agent/contexts`,
      {
        method: 'PUT',
        body: jsonBody({ ...input, status: 'confirmed' }),
      },
    )
    return response.context
  } catch (error) {
    return mapConflict(error)
  }
}

export async function rollbackSharedProjectContext(
  projectId: string,
  contextId: string,
  input: { expectedRevision: number; targetRevision: number },
  request: SharedProjectContextRequest = apiRequest,
): Promise<AgentProjectContext> {
  try {
    const response = await request<{ context: AgentProjectContext }>(
      `/api/projects/${encodeURIComponent(projectId)}/agent/contexts/${encodeURIComponent(contextId)}/rollback`,
      { method: 'POST', body: jsonBody(input) },
    )
    return response.context
  } catch (error) {
    return mapConflict(error)
  }
}

export async function deleteSharedProjectContext(
  projectId: string,
  contextId: string,
  expectedRevision: number,
  request: SharedProjectContextRequest = apiRequest,
): Promise<void> {
  try {
    await request<void>(
      `/api/projects/${encodeURIComponent(projectId)}/agent/contexts/${encodeURIComponent(contextId)}`,
      { method: 'DELETE', body: jsonBody({ expectedRevision }) },
    )
  } catch (error) {
    return mapConflict(error)
  }
}
