import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AgentProjectStartRecord, Repository } from '../types.js'
import { createAgentStartRoutes } from './agent-starts.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const now = new Date('2026-07-31T12:00:00.000Z')

function app(repository: Partial<Repository>, taskLoopEnabled = false, dispatcher?: { wake: () => void }) {
  const target = new Hono<{ Variables: AppVariables }>()
  target.use('*', async (context, next) => {
    context.set('actorId', actorId)
    context.set('accessToken', 'access')
    await next()
  })
  target.route(
    '/agent',
    createAgentStartRoutes(repository as Repository, () => now, dispatcher as never, taskLoopEnabled),
  )
  target.onError((error, context) => {
    if (error instanceof ApiError) {
      return context.json({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })
  return target
}

function request(attachments: unknown[] = [], schema: Record<string, unknown> = legacySchema()) {
  return new Request('https://app.example.com/agent/starts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      project: {
        name: '城市态势大屏',
        description: '综合态势',
        schema,
      },
      idempotencyKey,
      prompt: '创建一张城市运行综合态势大屏',
      attachments,
    }),
  })
}

function legacySchema(): Record<string, unknown> {
  return {
    version: '1.0.0',
    componentsTree: [
      {
        id: 'page-home-root',
        docId: 'page-home',
        fileName: 'home',
        componentName: 'Root',
        isRoot: true,
        $dashboard: { rect: { width: 1920, height: 1080 } },
        children: [],
      },
    ],
  }
}

describe('atomic Agent project start', () => {
  it('creates project, private conversation, task, and durable workspace in one repository call', async () => {
    const startAgentProject = vi.fn<NonNullable<Repository['startAgentProject']>>(async (_actorId, input) => {
      const createdAt = now
      return {
        project: {
          id: input.project.id,
          name: input.project.name,
          description: input.project.description ?? null,
          coverUrl: null,
          draftSchema: input.project.schema,
          draftVersion: 1,
          isFavorite: false,
          pageCount: 1,
          canvasWidth: 1920,
          canvasHeight: 1080,
          startPageId: null,
          draftSavedAt: createdAt,
          thumbnailMode: 'auto',
          thumbnailStatus: 'queued',
          thumbnailPath: null,
          thumbnailUrl: null,
          thumbnailDraftVersion: null,
          thumbnailErrorCode: null,
          publishedAt: null,
          currentReleaseNumber: null,
          deletedAt: null,
          createdAt,
          updatedAt: createdAt,
        },
        workspace: {
          ownerId: actorId,
          projectId: input.project.id,
          revision: 1,
          payload: input.workspacePayload,
          createdAt,
          updatedAt: createdAt,
        },
        dispatch: {
          operationId: input.dispatch!.operationId,
          taskId: input.dispatch!.taskId,
          state: input.dispatch!.waitingForUpload ? 'paused' : 'queued',
        } as AgentProjectStartRecord['dispatch'],
      } satisfies AgentProjectStartRecord
    })
    const response = await app({ startAgentProject }).request(request())

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      project: { id: string }
      conversation: {
        id: string
        projectId: string
        visibility: string
        tasks: Array<Record<string, unknown>>
      }
      workspace: { revision: number; payload: { conversations: unknown[] } }
      run: { operationId: string; taskId: string; status: string }
    }
    expect(body.conversation).toMatchObject({ projectId: body.project.id, visibility: 'private' })
    expect(body.conversation.tasks[0]).toMatchObject({ title: 'Agent 搭建任务' })
    expect(body.conversation.tasks[0]).not.toHaveProperty('status')
    expect(body.conversation.tasks[0]).not.toHaveProperty('stages')
    expect(body.conversation.tasks[0]).not.toHaveProperty('run')
    expect(body.workspace).toMatchObject({
      revision: 1,
      payload: { version: 2, conversations: [body.conversation] },
    })
    expect(startAgentProject).toHaveBeenCalledOnce()
    expect(startAgentProject.mock.calls[0]?.[1].project.schema).toMatchObject({
      formatVersion: 1,
      editorSchema: legacySchema(),
      presentation: { startPageId: 'page-home' },
    })
    expect(startAgentProject.mock.calls[0]?.[1]).toMatchObject({ idempotencyKey })
    expect(startAgentProject.mock.calls[0]?.[1].createLegacyDispatch).toBe(true)
    expect(startAgentProject.mock.calls[0]?.[1].dispatch).toMatchObject({
      conversationId: body.conversation.id,
      taskId: body.run.taskId,
      operationId: body.run.operationId,
      waitingForUpload: false,
    })
    expect(body.run.status).toBe('planning')
  })

  it('creates only the V2 display workspace when the semantic task loop is enabled', async () => {
    const wake = vi.fn()
    const startAgentProject = vi.fn<NonNullable<Repository['startAgentProject']>>(async (_actorId, input) => ({
      project: { id: input.project.id } as AgentProjectStartRecord['project'],
      workspace: {
        ownerId: actorId,
        projectId: input.project.id,
        revision: 1,
        payload: input.workspacePayload,
        createdAt: now,
        updatedAt: now,
      },
    }))

    const response = await app({ startAgentProject }, true, { wake }).request(request())

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      conversation: { tasks: Array<Record<string, unknown>> }
      workspace: { payload: { version: number } }
      run?: unknown
    }
    expect(body.workspace.payload.version).toBe(2)
    expect(body.conversation.tasks[0]).not.toHaveProperty('taskRunId')
    expect(body.conversation.tasks[0]).not.toHaveProperty('status')
    expect(body).not.toHaveProperty('run')
    expect(startAgentProject.mock.calls[0]?.[1]).toMatchObject({ createLegacyDispatch: false })
    expect(startAgentProject.mock.calls[0]?.[1].dispatch).toBeUndefined()
    expect(wake).not.toHaveBeenCalled()
  })

  it('does not create or finalize a legacy operation for semantic starts with attachments', async () => {
    const wake = vi.fn()
    const startAgentProject = vi.fn<NonNullable<Repository['startAgentProject']>>(async (_actorId, input) => ({
      project: { id: input.project.id } as AgentProjectStartRecord['project'],
      workspace: { payload: input.workspacePayload } as AgentProjectStartRecord['workspace'],
    }))
    const response = await app({ startAgentProject }, true, { wake }).request(
      request([{ name: '需求.md', scope: 'conversation', mimeType: 'text/markdown', size: 128 }]),
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as { run?: unknown }
    expect(body).not.toHaveProperty('run')
    expect(startAgentProject.mock.calls[0]?.[1].dispatch).toBeUndefined()
    expect(wake).not.toHaveBeenCalled()
  })

  it('replays the same project, conversation, and task after the first response is lost', async () => {
    let persisted: AgentProjectStartRecord | undefined
    const startAgentProject = vi.fn<NonNullable<Repository['startAgentProject']>>(async (_actorId, input) => {
      persisted ??= {
        project: {
          id: input.project.id,
          name: input.project.name,
          description: input.project.description ?? null,
          draftSchema: input.project.schema,
          createdAt: now,
          updatedAt: now,
        } as AgentProjectStartRecord['project'],
        workspace: {
          ownerId: actorId,
          projectId: input.project.id,
          revision: 1,
          payload: input.workspacePayload,
          createdAt: now,
          updatedAt: now,
        },
        dispatch: {
          operationId: input.dispatch!.operationId,
          taskId: input.dispatch!.taskId,
          state: input.dispatch!.waitingForUpload ? 'paused' : 'queued',
        } as AgentProjectStartRecord['dispatch'],
      }
      return persisted
    })
    const instance = app({ startAgentProject })

    const lostResponse = await instance.request(request())
    const retriedResponse = await instance.request(request())
    const first = (await lostResponse.json()) as {
      project: { id: string }
      conversation: { id: string; tasks: Array<{ id: string }> }
    }
    const retry = (await retriedResponse.json()) as typeof first

    expect(retriedResponse.status).toBe(201)
    expect(retry).toEqual(first)
    expect(startAgentProject).toHaveBeenCalledTimes(2)
    expect(startAgentProject.mock.calls[1]?.[1]).toMatchObject({
      idempotencyKey,
      inputDigest: startAgentProject.mock.calls[0]?.[1].inputDigest,
    })
  })

  it('preserves a canonical project document before the atomic repository call', async () => {
    const canonical = {
      formatVersion: 1,
      editorSchema: legacySchema(),
      presentation: { startPageId: 'page-home', theme: { mode: 'light', tokens: {} } },
      extension: { keep: true },
    }
    const startAgentProject = vi.fn<NonNullable<Repository['startAgentProject']>>(async (_actorId, input) => {
      return {
        project: { id: input.project.id } as AgentProjectStartRecord['project'],
        workspace: {
          ownerId: actorId,
          projectId: input.project.id,
          revision: 1,
          payload: input.workspacePayload,
          createdAt: now,
          updatedAt: now,
        },
        dispatch: {
          operationId: input.dispatch!.operationId,
          taskId: input.dispatch!.taskId,
          state: input.dispatch!.waitingForUpload ? 'paused' : 'queued',
        } as AgentProjectStartRecord['dispatch'],
      }
    })

    await app({ startAgentProject }).request(request([], canonical))

    expect(startAgentProject.mock.calls[0]?.[1].project.schema).toEqual(canonical)
  })

  it('returns a clear 422 before persistence when a start page cannot be derived', async () => {
    const startAgentProject = vi.fn<NonNullable<Repository['startAgentProject']>>()

    const response = await app({ startAgentProject }).request(
      request([], { version: '1.0.0', componentsTree: [{ componentName: 'Root', children: [] }] }),
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'INVALID_DASHBOARD_DOCUMENT' } })
    expect(startAgentProject).not.toHaveBeenCalled()
  })

  it('pauses the initial task until declared project-bound uploads are attached', async () => {
    const startAgentProject = vi.fn<NonNullable<Repository['startAgentProject']>>(async (_actorId, input) => ({
      project: { id: input.project.id } as AgentProjectStartRecord['project'],
      workspace: { payload: input.workspacePayload } as AgentProjectStartRecord['workspace'],
      dispatch: {
        operationId: input.dispatch!.operationId,
        taskId: input.dispatch!.taskId,
        state: input.dispatch!.waitingForUpload ? 'paused' : 'queued',
      } as AgentProjectStartRecord['dispatch'],
    }))
    const response = await app({ startAgentProject }).request(
      request([
        {
          name: '需求.md',
          scope: 'conversation',
          mimeType: 'text/markdown',
          size: 128,
        },
      ]),
    )
    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      conversation: { messages: Array<{ attachments: unknown[] }>; tasks: Array<Record<string, unknown>> }
      run: { status: string }
    }
    expect(body.conversation.messages[0]?.attachments).toEqual([])
    expect(body.conversation.tasks[0]).not.toHaveProperty('status')
    expect(body.conversation.tasks[0]).not.toHaveProperty('stages')
    expect(body.run.status).toBe('paused')
    expect(startAgentProject).toHaveBeenCalledOnce()
  })

  it('rejects malformed attachment manifests before creating the project', async () => {
    const startAgentProject = vi.fn<NonNullable<Repository['startAgentProject']>>()
    const response = await app({ startAgentProject }).request(request([{ name: '需求.md' }]))
    expect(response.status).toBe(422)
    expect(startAgentProject).not.toHaveBeenCalled()
  })

  it('fails explicitly when the transactional repository capability is unavailable', async () => {
    const response = await app({}).request(request())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AGENT_START_UNAVAILABLE' } })
  })
})
