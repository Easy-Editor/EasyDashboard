import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AgentScreenshotArtifactRecord, Repository } from '../types.js'
import { createAgentScreenshotArtifactRoutes } from './agent-screenshot-artifacts.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const artifactId = '33333333-3333-4333-8333-333333333333'
const operationId = 'operation-1'
const candidateSha256 = 'a'.repeat(64)
const screenshotSha256 = 'b'.repeat(64)
const path = `${actorId}/${projectId}/${artifactId}.png`
const artifact: AgentScreenshotArtifactRecord = {
  id: artifactId,
  actorId,
  projectId,
  operationId,
  candidateSha256,
  draftVersion: 5,
  contentType: 'image/png',
  size: 1024,
  sha256: screenshotSha256,
  status: 'uploading',
  storagePath: path,
  completedAt: null,
  createdAt: new Date('2026-08-05T04:00:00.000Z'),
  updatedAt: new Date('2026-08-05T04:00:00.000Z'),
}

function app(repository: Partial<Repository>) {
  const instance = new Hono<{ Variables: AppVariables }>()
  instance.use('*', async (c, next) => {
    c.set('actorId', actorId)
    c.set('accessToken', 'access-token')
    await next()
  })
  instance.route('/projects', createAgentScreenshotArtifactRoutes(repository as Repository))
  instance.onError((error, c) =>
    error instanceof ApiError
      ? c.json({ error: { code: error.code } }, error.status)
      : c.json({ error: { code: 'INTERNAL' } }, 500),
  )
  return instance
}

const uploadBody = {
  candidateSha256,
  draftVersion: 5,
  contentType: 'image/png',
  size: 1024,
  sha256: screenshotSha256,
}

describe('Agent screenshot artifact routes', () => {
  it('reserves an exact operation-bound signed upload', async () => {
    const create = vi.fn(async () => ({
      artifact,
      bucket: 'easy-dashboard-agent-screenshots',
      path,
      signedUrl: 'https://storage.example/upload',
      token: 'upload-token',
      maxBytes: 10 * 1024 * 1024,
      expiresIn: 7200,
      alreadyCompleted: false as const,
    }))
    const response = await app({ createAgentScreenshotArtifactUpload: create }).request(
      `/projects/${projectId}/agent-spike/operations/${operationId}/screenshot-artifact/upload`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(uploadBody),
      },
    )

    expect(response.status).toBe(201)
    expect(create).toHaveBeenCalledWith(actorId, 'access-token', projectId, operationId, uploadBody)
  })

  it('returns an exact completed replay and maps identity drift to conflict', async () => {
    const ready = { ...artifact, status: 'ready' as const, completedAt: new Date('2026-08-05T04:01:00.000Z') }
    const replayResponse = await app({
      createAgentScreenshotArtifactUpload: vi.fn(async () => ({ artifact: ready, alreadyCompleted: true as const })),
    }).request(`/projects/${projectId}/agent-spike/operations/${operationId}/screenshot-artifact/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(uploadBody),
    })
    const conflictResponse = await app({
      createAgentScreenshotArtifactUpload: vi.fn(async () => 'conflict' as const),
    }).request(`/projects/${projectId}/agent-spike/operations/${operationId}/screenshot-artifact/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(uploadBody),
    })

    expect(replayResponse.status).toBe(200)
    expect(conflictResponse.status).toBe(409)
    await expect(conflictResponse.json()).resolves.toEqual({
      error: { code: 'AGENT_SCREENSHOT_ARTIFACT_IDEMPOTENCY_CONFLICT' },
    })
  })

  it('completes and returns signed download metadata', async () => {
    const ready = { ...artifact, status: 'ready' as const, completedAt: new Date('2026-08-05T04:01:00.000Z') }
    const complete = vi.fn(async () => ready)
    const download = vi.fn(async () => ({
      artifact: ready,
      signedUrl: 'https://storage.example/download',
      expiresIn: 60,
    }))
    const instance = app({
      completeAgentScreenshotArtifactUpload: complete,
      getAgentScreenshotArtifactDownload: download,
    })
    const completed = await instance.request(
      `/projects/${projectId}/agent-spike/operations/${operationId}/screenshot-artifact/complete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactId, path }),
      },
    )
    const metadata = await instance.request(
      `/projects/${projectId}/agent-spike/operations/${operationId}/screenshot-artifact`,
    )

    expect(completed.status).toBe(200)
    expect(metadata.status).toBe(200)
    expect(complete).toHaveBeenCalledWith(actorId, 'access-token', projectId, operationId, { artifactId, path })
    expect(download).toHaveBeenCalledWith(actorId, 'access-token', projectId, operationId)
  })

  it('rejects any content type other than image/png before repository access', async () => {
    const create = vi.fn()
    const response = await app({ createAgentScreenshotArtifactUpload: create }).request(
      `/projects/${projectId}/agent-spike/operations/${operationId}/screenshot-artifact/upload`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...uploadBody, contentType: 'image/webp' }),
      },
    )

    expect(response.status).toBe(422)
    expect(create).not.toHaveBeenCalled()
  })
})
