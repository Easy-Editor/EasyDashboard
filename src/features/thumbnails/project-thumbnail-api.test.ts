import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishThumbnailArtifact, uploadThumbnailToSignedUrl } from './project-thumbnail-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadThumbnailToSignedUrl', () => {
  it('matches storage-js 2.111.0 signed Blob upload wire semantics without app credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const blob = new Blob(['webp'], { type: 'image/webp' })

    await uploadThumbnailToSignedUrl(
      {
        bucket: 'easy-dashboard-thumbnails',
        path: 'actor/project/7/artifact.webp',
        signedUrl: 'https://storage.example.com/object/upload/sign/bucket/path?token=upload-token',
        token: 'upload-token',
        draftVersion: 7,
        mode: 'auto',
        contentType: 'image/webp',
        maxBytes: 10 * 1024 * 1024,
        expiresIn: 7200,
      },
      blob,
      { cacheControl: '3600', metadata: { source: 'renderer' } },
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    const body = init.body as FormData

    expect(url).toBe('https://storage.example.com/object/upload/sign/bucket/path?token=upload-token')
    expect(init.method).toBe('PUT')
    expect(init.credentials).toBe('omit')
    expect(headers.get('x-upsert')).toBe('false')
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('x-csrf-token')).toBe(false)
    expect(headers.has('content-type')).toBe(false)
    expect(body.get('cacheControl')).toBe('3600')
    expect(body.get('metadata')).toBe('{"source":"renderer"}')
    expect(body.get('')).toMatchObject({ size: blob.size, type: blob.type })
  })
})

describe('publishThumbnailArtifact failure identity', () => {
  it('reports the immutable upload path when the complete response is lost', async () => {
    const path = 'actor/project/7/immutable-attempt.webp'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            upload: {
              bucket: 'easy-dashboard-thumbnails',
              path,
              signedUrl: 'https://storage.example.com/signed-upload',
              token: 'upload-token',
              draftVersion: 7,
              mode: 'auto',
              contentType: 'image/webp',
              maxBytes: 10 * 1024 * 1024,
              expiresIn: 7200,
            },
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({ error: { code: 'NETWORK_RESPONSE_LOST', message: 'response lost' } }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 'THUMBNAIL_VERSION_CONFLICT', message: 'attempt already completed' } },
          { status: 409 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      publishThumbnailArtifact('project', {
        draftVersion: 7,
        mode: 'auto',
        source: 'renderer',
        contentType: 'image/webp',
        size: 4,
        blob: new Blob(['webp'], { type: 'image/webp' }),
      }),
    ).rejects.toThrow('response lost')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const [failureUrl, failureInit] = fetchMock.mock.calls[3] as [string, RequestInit]
    expect(failureUrl).toBe('/api/projects/project/thumbnail/fail')
    expect(JSON.parse(failureInit.body as string)).toEqual({
      draftVersion: 7,
      path,
      errorCode: 'thumbnail-upload-failed',
    })
  })
})
