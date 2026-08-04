import { createHash } from 'node:crypto'

export const MAX_ASSET_MODEL_INPUT_BYTES = 4 * 1024 * 1024

export type AssetModelInputContentType = 'image/png' | 'image/jpeg' | 'image/webp'

export type AssetModelInputRecord = Readonly<{
  contentType: AssetModelInputContentType
  size: number
  sha256: string
}>

export type EncodedAssetModelInput = Readonly<{
  record: AssetModelInputRecord
  copiedBytes: Readonly<Uint8Array>
  dataUrl: string
}>

export type AssetModelInputErrorCode =
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'IMAGE_TOO_LARGE'
  | 'MEDIA_TYPE_MISMATCH'
  | 'PERSISTED_RECORD_MISMATCH'

export class AssetModelInputError extends Error {
  constructor(readonly code: AssetModelInputErrorCode) {
    super(
      code === 'UNSUPPORTED_MEDIA_TYPE'
        ? 'Unsupported image media type'
        : code === 'IMAGE_TOO_LARGE'
          ? 'Image exceeds the model input size limit'
          : code === 'MEDIA_TYPE_MISMATCH'
            ? 'Image content does not match the declared media type'
            : 'Persisted image metadata does not match the image content',
    )
    this.name = 'AssetModelInputError'
  }
}

function supportedContentType(contentType: string): contentType is AssetModelInputContentType {
  return contentType === 'image/png' || contentType === 'image/jpeg' || contentType === 'image/webp'
}

function hasExpectedMagic(contentType: AssetModelInputContentType, bytes: Readonly<Uint8Array>): boolean {
  if (contentType === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    )
  }
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
}

function validatedContentType(contentType: string, bytes: Readonly<Uint8Array>): AssetModelInputContentType {
  if (!supportedContentType(contentType)) throw new AssetModelInputError('UNSUPPORTED_MEDIA_TYPE')
  if (bytes.byteLength > MAX_ASSET_MODEL_INPUT_BYTES) throw new AssetModelInputError('IMAGE_TOO_LARGE')
  if (!hasExpectedMagic(contentType, bytes)) throw new AssetModelInputError('MEDIA_TYPE_MISMATCH')
  return contentType
}

function encodeValidated(
  contentType: AssetModelInputContentType,
  sourceBytes: Readonly<Uint8Array>,
): EncodedAssetModelInput {
  const copiedBytes = new Uint8Array(sourceBytes)
  const sha256 = createHash('sha256').update(copiedBytes).digest('hex')
  const base64 = Buffer.from(copiedBytes.buffer, copiedBytes.byteOffset, copiedBytes.byteLength).toString('base64')
  const record = Object.freeze({ contentType, size: copiedBytes.byteLength, sha256 })
  return Object.freeze({ record, copiedBytes, dataUrl: `data:${contentType};base64,${base64}` })
}

export function encodeAssetModelInput(contentType: string, bytes: Readonly<Uint8Array>): EncodedAssetModelInput {
  return encodeValidated(validatedContentType(contentType, bytes), bytes)
}

export function decodeAssetModelInput(
  record: AssetModelInputRecord,
  persistedBytes: Readonly<Uint8Array>,
): EncodedAssetModelInput {
  const encoded = encodeAssetModelInput(record.contentType, persistedBytes)
  if (encoded.record.size !== record.size || encoded.record.sha256 !== record.sha256) {
    throw new AssetModelInputError('PERSISTED_RECORD_MISMATCH')
  }
  return encoded
}
