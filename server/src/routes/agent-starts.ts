import { createHash, randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { InvalidDashboardDocumentError, canonicalizeDashboardDocument } from '../agent/canonical-dashboard-document.js'
import { parseAgentProjectWorkspacePayload } from '../agent/workspace-contract.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AgentRunDispatcher } from '../services/agent-run-dispatcher.js'
import type { Repository } from '../types.js'
import { ValidationError, assertCanvasDimensions, assertSchemaBudget, projectSchemaSchema } from '../validation.js'

const requestSchema = z
  .object({
    idempotencyKey: z.uuid(),
    project: z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(1_000).nullable().optional(),
        schema: projectSchemaSchema,
      })
      .strict(),
    prompt: z.string().trim().min(1).max(4_000),
    // Files still use project-bound signed uploads. Their bounded manifest is
    // accepted here so the initial task remains paused until every upload is
    // durably attached; the client resumes it only after the workspace CAS
    // has bound the completed asset IDs to the initial message.
    attachments: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(255),
            scope: z.enum(['conversation', 'project']),
            mimeType: z.string().trim().min(1).max(255).optional(),
            type: z.string().trim().min(1).max(120).optional(),
            size: z
              .number()
              .int()
              .positive()
              .max(20 * 1024 * 1024)
              .optional(),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict()

function assertProjectBudget(schema: Record<string, unknown>): void {
  try {
    assertCanvasDimensions(schema)
    assertSchemaBudget(schema)
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new ApiError(error.code === 'INVALID_CANVAS_DIMENSION' ? 422 : 413, error.code, error.message)
    }
    throw error
  }
}

function canonicalProjectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  try {
    return canonicalizeDashboardDocument(schema)
  } catch (error) {
    if (error instanceof InvalidDashboardDocumentError) {
      throw new ApiError(422, 'INVALID_DASHBOARD_DOCUMENT', error.message)
    }
    throw error
  }
}

export function createAgentStartRoutes(
  repository: Repository,
  now: () => Date = () => new Date(),
  dispatcher?: AgentRunDispatcher | null,
  taskLoopEnabled = false,
) {
  const routes = new Hono<{ Variables: AppVariables }>()

  routes.post('/starts', async context => {
    if (!repository.startAgentProject) {
      throw new ApiError(503, 'AGENT_START_UNAVAILABLE', 'Atomic Agent project creation is unavailable')
    }
    const input = await readJson(context, requestSchema)
    const schema = canonicalProjectSchema(input.project.schema)
    assertProjectBudget(schema)
    const inputDigest = createHash('sha256')
      .update(
        JSON.stringify({
          project: { ...input.project, schema },
          prompt: input.prompt,
          attachments: input.attachments,
          executionMode: taskLoopEnabled ? 'semantic_task_loop' : 'legacy_dispatch',
        }),
      )
      .digest('hex')
    const actorId = context.get('actorId')
    const createdAt = now().toISOString()
    const projectId = randomUUID()
    const conversationId = `conversation-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const operationId = `operation-${randomUUID()}`
    const conversation = {
      id: conversationId,
      ownerUserId: actorId,
      projectId,
      projectName: input.project.name,
      visibility: 'private' as const,
      title: input.prompt.slice(0, 40),
      messages: [
        {
          id: `message-${randomUUID()}`,
          taskId,
          role: 'user' as const,
          content: input.prompt,
          attachments: [],
          createdAt,
        },
      ],
      tasks: [
        {
          id: taskId,
          title: 'Agent 搭建任务',
          createdAt,
          updatedAt: createdAt,
        },
      ],
      createdAt,
      updatedAt: createdAt,
    }
    const workspacePayload = parseAgentProjectWorkspacePayload(
      {
        version: 2,
        ownerUserId: actorId,
        projectId,
        conversations: [conversation],
        projectContexts: [],
      },
      actorId,
      projectId,
    )
    const started = await repository.startAgentProject(actorId, {
      project: { ...input.project, id: projectId, schema },
      workspacePayload,
      createLegacyDispatch: !taskLoopEnabled,
      dispatch: taskLoopEnabled
        ? undefined
        : {
            conversationId,
            taskId,
            operationId,
            waitingForUpload: input.attachments.length > 0,
          },
      idempotencyKey: input.idempotencyKey,
      inputDigest,
    })
    if (started === 'conflict') {
      throw new ApiError(409, 'AGENT_START_IDEMPOTENCY_CONFLICT', 'Agent start idempotency key was reused')
    }

    // A replay returns the original aggregate, so the response must come from
    // the persisted workspace rather than the provisional IDs built above.
    const persistedWorkspace = parseAgentProjectWorkspacePayload(started.workspace.payload, actorId, started.project.id)
    const persistedConversation = persistedWorkspace.conversations[0]
    if (!persistedConversation) throw new Error('Atomic Agent start workspace did not preserve its conversation')
    const persistedTask = persistedConversation.tasks[0]
    const legacyOperationId =
      persistedWorkspace.version === 1 ? persistedWorkspace.conversations[0]?.tasks[0]?.run?.operationId : undefined
    const persistedOperationId = started.dispatch?.operationId ?? legacyOperationId
    if (!persistedTask) throw new Error('Atomic Agent start workspace did not preserve its initial task')
    if (!taskLoopEnabled && !persistedOperationId) {
      throw new Error('Atomic Agent start did not preserve its initial run')
    }
    if (!taskLoopEnabled) dispatcher?.wake()
    return context.json(
      {
        project: started.project,
        conversation: persistedConversation,
        workspace: started.workspace,
        ...(taskLoopEnabled
          ? {}
          : {
              run: {
                operationId: persistedOperationId!,
                taskId: started.dispatch?.taskId ?? persistedTask.id,
                status:
                  started.dispatch?.state === 'paused' ||
                  (persistedWorkspace.version === 1 &&
                    persistedWorkspace.conversations[0]?.tasks[0]?.run?.status === 'paused')
                    ? 'paused'
                    : 'planning',
              },
            }),
      },
      201,
    )
  })

  return routes
}
