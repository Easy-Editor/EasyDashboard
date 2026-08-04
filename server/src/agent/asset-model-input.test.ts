import { describe, expect, it } from 'vitest'
import {
  AssetModelInputError,
  MAX_ASSET_MODEL_INPUT_BYTES,
  decodeAssetModelInput,
  encodeAssetModelInput,
} from './asset-model-input.js'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x61, 0x62, 0x63])
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x61, 0x62, 0x63])
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x03, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x61, 0x62, 0x63])

describe('asset model input codec', () => {
  it.each([
    ['image/png', png],
    ['image/jpeg', jpeg],
    ['image/webp', webp],
  ] as const)('accepts %s and returns bounded model and persistence representations', (contentType, bytes) => {
    const result = encodeAssetModelInput(contentType, bytes)

    expect(result.record).toEqual({
      contentType,
      size: bytes.byteLength,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })
    expect(result.dataUrl).toBe(`data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`)
    expect(result.copiedBytes).toEqual(bytes)
    expect(result.copiedBytes).not.toBe(bytes)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.record)).toBe(true)
    expect(JSON.parse(JSON.stringify(result.record))).toEqual(result.record)
  })

  it('rejects bytes whose magic does not match the declared media type', () => {
    expect(() => encodeAssetModelInput('image/png', jpeg)).toThrowError(
      expect.objectContaining({ code: 'MEDIA_TYPE_MISMATCH' }),
    )
  })

  it('rejects images larger than 4 MiB', () => {
    const oversized = new Uint8Array(MAX_ASSET_MODEL_INPUT_BYTES + 1)
    oversized.set(png)

    expect(() => encodeAssetModelInput('image/png', oversized)).toThrowError(
      expect.objectContaining({ code: 'IMAGE_TOO_LARGE' }),
    )
  })

  it.each(['image/svg+xml', 'image/gif', 'application/octet-stream'])(
    'rejects unsupported media type %s',
    contentType => {
      expect(() => encodeAssetModelInput(contentType, png)).toThrowError(
        expect.objectContaining({ code: 'UNSUPPORTED_MEDIA_TYPE' }),
      )
    },
  )

  it('computes a deterministic digest and reconstructs model input from persisted bytes', () => {
    const encoded = encodeAssetModelInput('image/png', png)

    expect(encoded.record.sha256).toBe('2cb922ecae93d405c9b9631a154ff097e354a411d5444196a182a0ffcbe63071')
    const decoded = decodeAssetModelInput(encoded.record, encoded.copiedBytes)
    expect(decoded.record).toEqual(encoded.record)
    expect(decoded.dataUrl).toBe(encoded.dataUrl)
    expect(decoded.copiedBytes).not.toBe(encoded.copiedBytes)
  })

  it('does not mutate or retain the caller-owned byte buffer', () => {
    const source = new Uint8Array(png)
    const snapshot = new Uint8Array(source)
    const result = encodeAssetModelInput('image/png', source)

    expect(source).toEqual(snapshot)
    source[source.length - 1] = 0xff
    expect(result.copiedBytes).toEqual(snapshot)
    expect(result.dataUrl).toBe(`data:image/png;base64,${Buffer.from(snapshot).toString('base64')}`)
  })

  it('rejects persisted bytes that do not match their bounded record', () => {
    const encoded = encodeAssetModelInput('image/png', png)
    const changed = new Uint8Array(encoded.copiedBytes)
    const lastIndex = changed.length - 1
    changed[lastIndex] = (changed[lastIndex] ?? 0) ^ 0xff

    expect(() => decodeAssetModelInput(encoded.record, changed)).toThrowError(
      expect.objectContaining({ code: 'PERSISTED_RECORD_MISMATCH' }),
    )
  })

  it('keeps rejection errors free of raw image content', () => {
    const secret = 'DO_NOT_EXPOSE_IMAGE_CONTENT'
    const bytes = new TextEncoder().encode(secret)

    try {
      encodeAssetModelInput('image/png', bytes)
      throw new Error('Expected image rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(AssetModelInputError)
      const serialized = JSON.stringify({
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
        code: (error as AssetModelInputError).code,
      })
      expect(serialized).not.toContain(secret)
      expect(serialized).not.toContain(Buffer.from(bytes).toString('base64'))
    }
  })
})
