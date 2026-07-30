const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type CustomImageMetadata = {
  type: string
  size: number
  width: number
  height: number
}

export type CustomImageValidation =
  | { ok: true; metadata: CustomImageMetadata }
  | {
      ok: false
      code: 'unsupported-type' | 'file-too-large' | 'invalid-dimensions'
      message: string
    }

export type CoverCropPlan = {
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  outputWidth: number
  outputHeight: number
}

export type DecodedCustomImage = {
  source: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

export type CustomImageRuntime = {
  decode(file: Blob): Promise<DecodedCustomImage>
  renderCrop(image: DecodedCustomImage, crop: CoverCropPlan, quality: number): Promise<Blob>
}

export class CustomThumbnailValidationError extends Error {
  override readonly name = 'CustomThumbnailValidationError'

  constructor(readonly validation: Exclude<CustomImageValidation, { ok: true }>) {
    super(validation.message)
  }
}

export function validateCustomThumbnail(
  metadata: CustomImageMetadata,
  options: {
    maxBytes?: number
    acceptedTypes?: readonly string[]
  } = {},
): CustomImageValidation {
  const acceptedTypes = options.acceptedTypes ?? DEFAULT_TYPES
  if (!acceptedTypes.includes(metadata.type)) {
    return {
      ok: false,
      code: 'unsupported-type',
      message: `Unsupported thumbnail type: ${metadata.type || 'unknown'}`,
    }
  }
  if (!Number.isFinite(metadata.size) || metadata.size < 0 || metadata.size > (options.maxBytes ?? DEFAULT_MAX_BYTES)) {
    return {
      ok: false,
      code: 'file-too-large',
      message: 'Thumbnail image exceeds the configured size limit',
    }
  }
  if (
    !Number.isFinite(metadata.width) ||
    !Number.isFinite(metadata.height) ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    return {
      ok: false,
      code: 'invalid-dimensions',
      message: 'Thumbnail image dimensions are invalid',
    }
  }
  return { ok: true, metadata }
}

export function planCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth = 960,
  targetHeight = 540,
): CoverCropPlan {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    throw new RangeError('Crop dimensions must be positive')
  }

  const targetRatio = targetWidth / targetHeight
  const sourceRatio = sourceWidth / sourceHeight
  const sourceCropWidth = sourceRatio > targetRatio ? sourceHeight * targetRatio : sourceWidth
  const sourceCropHeight = sourceRatio > targetRatio ? sourceHeight : sourceWidth / targetRatio
  const scale = Math.min(1, targetWidth / sourceCropWidth, targetHeight / sourceCropHeight)

  return {
    sourceX: (sourceWidth - sourceCropWidth) / 2,
    sourceY: (sourceHeight - sourceCropHeight) / 2,
    sourceWidth: sourceCropWidth,
    sourceHeight: sourceCropHeight,
    outputWidth: Math.round(sourceCropWidth * scale),
    outputHeight: Math.round(sourceCropHeight * scale),
  }
}

function encodeCanvas(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Browser could not encode the custom thumbnail as WebP'))),
        'image/webp',
        quality,
      )
    } catch (error) {
      reject(error)
    }
  })
}

export const browserCustomImageRuntime: CustomImageRuntime = {
  async decode(file) {
    const bitmap = await createImageBitmap(file)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }
  },

  async renderCrop(image, crop, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = crop.outputWidth
    canvas.height = crop.outputHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is unavailable')
    context.drawImage(
      image.source,
      crop.sourceX,
      crop.sourceY,
      crop.sourceWidth,
      crop.sourceHeight,
      0,
      0,
      crop.outputWidth,
      crop.outputHeight,
    )
    return encodeCanvas(canvas, quality)
  },
}

export async function prepareCustomThumbnail(
  file: Blob,
  options: {
    maxBytes?: number
    acceptedTypes?: readonly string[]
    width?: number
    height?: number
    quality?: number
  } = {},
  runtime: CustomImageRuntime = browserCustomImageRuntime,
): Promise<{
  blob: Blob
  metadata: CustomImageMetadata
  crop: CoverCropPlan
}> {
  const image = await runtime.decode(file)
  try {
    const metadata = {
      type: file.type,
      size: file.size,
      width: image.width,
      height: image.height,
    }
    const validation = validateCustomThumbnail(metadata, options)
    if (!validation.ok) throw new CustomThumbnailValidationError(validation)
    const crop = planCoverCrop(image.width, image.height, options.width ?? 960, options.height ?? 540)
    const blob = await runtime.renderCrop(image, crop, options.quality ?? 0.82)
    return { blob, metadata, crop }
  } finally {
    image.close?.()
  }
}
