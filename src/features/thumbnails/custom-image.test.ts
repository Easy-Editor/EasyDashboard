import { describe, expect, it } from 'vitest'
import { type CustomImageRuntime, planCoverCrop, prepareCustomThumbnail, validateCustomThumbnail } from './custom-image'

describe('custom thumbnail helpers', () => {
  it('rejects unsupported, oversized, and invalid image inputs with stable error codes', () => {
    expect(validateCustomThumbnail({ type: 'image/gif', size: 100, width: 800, height: 600 })).toMatchObject({
      ok: false,
      code: 'unsupported-type',
    })
    expect(
      validateCustomThumbnail({
        type: 'image/png',
        size: 11 * 1024 * 1024,
        width: 800,
        height: 600,
      }),
    ).toMatchObject({ ok: false, code: 'file-too-large' })
    expect(validateCustomThumbnail({ type: 'image/png', size: 100, width: 0, height: 600 })).toMatchObject({
      ok: false,
      code: 'invalid-dimensions',
    })
  })

  it('returns a centered 16:9 cover crop without upscaling the source', () => {
    expect(planCoverCrop(1600, 1200, 960, 540)).toEqual({
      sourceX: 0,
      sourceY: 150,
      sourceWidth: 1600,
      sourceHeight: 900,
      outputWidth: 960,
      outputHeight: 540,
    })

    expect(planCoverCrop(480, 270, 960, 540)).toMatchObject({
      sourceWidth: 480,
      sourceHeight: 270,
      outputWidth: 480,
      outputHeight: 270,
    })
  })

  it('exposes an injectable browser decode/crop seam for a validated custom file', async () => {
    const output = new Blob(['webp'], { type: 'image/webp' })
    const runtime: CustomImageRuntime = {
      decode: async () => ({ source: {} as CanvasImageSource, width: 1600, height: 1200 }),
      renderCrop: async (_image, crop, quality) => {
        expect(crop).toMatchObject({ sourceY: 150, outputWidth: 960, outputHeight: 540 })
        expect(quality).toBe(0.82)
        return output
      },
    }
    const file = new Blob(['png'], { type: 'image/png' })

    await expect(prepareCustomThumbnail(file, {}, runtime)).resolves.toMatchObject({
      blob: output,
      metadata: { type: 'image/png', size: 3, width: 1600, height: 1200 },
    })
  })
})
