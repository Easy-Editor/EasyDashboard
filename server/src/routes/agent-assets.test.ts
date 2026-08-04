import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'
import { createAgentAssetRoutes } from './agent-assets.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function app(repository: Partial<Repository>) {
  const instance = new Hono<{ Variables: AppVariables }>()
  instance.use('*', async (c, next) => {
    c.set('actorId', actorId)
    c.set('accessToken', 'token')
    await next()
  })
  instance.route('/projects', createAgentAssetRoutes(repository as Repository))
  instance.onError((error, c) =>
    error instanceof ApiError
      ? c.json({ error: { code: error.code } }, error.status)
      : c.json({ error: { code: 'INTERNAL' } }, 500),
  )
  return instance
}

it('creates an upload and rejects quota', async () => {
  const create = vi.fn(async () => ({
    id: 'a',
    bucket: 'b',
    path: 'p',
    signedUrl: 'u',
    token: 't',
    maxBytes: 1,
    expiresIn: 60,
  }))
  const response = await app({ createAgentAssetUpload: create }).request(`/projects/${projectId}/agent-assets/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idempotencyKey, scope: 'project', name: 'a.csv', contentType: 'text/csv', size: 10 }),
  })
  expect(response.status).toBe(201)
  expect(create).toHaveBeenCalledWith(actorId, 'token', projectId, expect.objectContaining({ name: 'a.csv' }))
})
it('passes the same actor-scoped selected-file key on an upload retry', async () => {
  const upload = {
    id: 'asset-id',
    bucket: 'bucket',
    path: 'actor/project/asset-id/a.csv',
    signedUrl: 'https://upload.test',
    token: 'token',
    maxBytes: 20,
    expiresIn: 60,
  }
  const create = vi.fn(async () => upload)
  const instance = app({ createAgentAssetUpload: create })
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idempotencyKey, scope: 'project', name: 'a.csv', contentType: 'text/csv', size: 10 }),
  }

  const first = await instance.request(`/projects/${projectId}/agent-assets/upload`, init)
  const retry = await instance.request(`/projects/${projectId}/agent-assets/upload`, init)

  await expect(first.json()).resolves.toEqual({ upload })
  await expect(retry.json()).resolves.toEqual({ upload })
  expect(create).toHaveBeenNthCalledWith(1, actorId, 'token', projectId, expect.objectContaining({ idempotencyKey }))
  expect(create).toHaveBeenNthCalledWith(2, actorId, 'token', projectId, expect.objectContaining({ idempotencyKey }))
})
it('completes, downloads, and deletes an asset', async () => {
  const assetId = '44444444-4444-4444-8444-444444444444'
  const complete = vi.fn(async () => ({ id: assetId, status: 'ready' })) as any
  const url = vi.fn(async () => 'https://signed')
  const del = vi.fn(async () => true)
  const instance = app({ completeAgentAssetUpload: complete, getAgentAssetDownloadUrl: url, deleteAgentAsset: del })
  const done = await instance.request(`/projects/${projectId}/agent-assets/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: assetId, path: 'p' }),
  })
  const content = await instance.request(`/projects/${projectId}/agent-assets/${assetId}/content`)
  const removed = await instance.request(`/projects/${projectId}/agent-assets/${assetId}`, { method: 'DELETE' })
  expect(done.status).toBe(200)
  expect(content.status).toBe(302)
  expect(removed.status).toBe(204)
})

it('persists validated image model bytes without advancing an upload-waiting dispatch', async () => {
  const assetId = '44444444-4444-4444-8444-444444444444'
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const persist = vi.fn(async () => true)
  const wakeEligible = vi.fn(async () => true)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(png, { status: 200 })),
  )
  const instance = app({
    completeAgentAssetUpload: vi.fn(async () => ({
      id: assetId,
      contentType: 'image/png',
      status: 'ready',
    })) as never,
    getAgentAssetDownloadUrl: vi.fn(async () => 'https://storage.example/image'),
    persistAgentAssetModelInput: persist,
    wakeAgentRunDispatchForAsset: wakeEligible,
  } as Partial<Repository>)

  const response = await instance.request(`/projects/${projectId}/agent-assets/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: assetId, path: 'p' }),
  })

  expect(response.status).toBe(200)
  expect(persist).toHaveBeenCalledWith(
    actorId,
    projectId,
    assetId,
    expect.objectContaining({ record: expect.objectContaining({ contentType: 'image/png', size: png.byteLength }) }),
  )
  expect(wakeEligible).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
