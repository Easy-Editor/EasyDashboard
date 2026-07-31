import { describe, expect, it } from 'vitest'
import {
  commitAutoThumbnail,
  createThumbnailState,
  failAutoThumbnail,
  queueAutoThumbnail,
  setCustomThumbnail,
  startAutoThumbnailRender,
} from './state'

describe('thumbnail state', () => {
  it('preserves the last good image while a newer automatic thumbnail is queued and fails', () => {
    const initial = createThumbnailState({
      mode: 'auto',
      imageUrl: '/thumb-v3.webp',
      capturedVersion: 3,
    })

    const queued = queueAutoThumbnail(initial, 4)
    const rendering = startAutoThumbnailRender(queued, 4)
    const failed = failAutoThumbnail(rendering, 4, 'Cross-origin image blocked capture')

    expect(failed).toMatchObject({
      mode: 'auto',
      status: 'failed',
      requestedVersion: 4,
      capturedVersion: 3,
      imageUrl: '/thumb-v3.webp',
      lastGoodUrl: '/thumb-v3.webp',
      error: 'Cross-origin image blocked capture',
    })
  })

  it('commits only the thumbnail matching the latest requested draft version', () => {
    const rendering = startAutoThumbnailRender(queueAutoThumbnail(createThumbnailState(), 8), 8)

    expect(commitAutoThumbnail(rendering, 7, '/thumb-v7.webp')).toEqual(rendering)
    expect(commitAutoThumbnail(rendering, 8, '/thumb-v8.webp')).toMatchObject({
      status: 'ready',
      capturedVersion: 8,
      requestedVersion: 8,
      imageUrl: '/thumb-v8.webp',
      lastGoodUrl: '/thumb-v8.webp',
    })
  })

  it('switches to a custom image without retaining an automatic captured version', () => {
    const automatic = createThumbnailState({
      imageUrl: '/thumb-v3.webp',
      capturedVersion: 3,
    })

    expect(setCustomThumbnail(automatic, '/custom.webp')).toMatchObject({
      mode: 'custom',
      status: 'ready',
      requestedVersion: null,
      capturedVersion: null,
      imageUrl: '/custom.webp',
      lastGoodUrl: '/custom.webp',
    })
  })
})
