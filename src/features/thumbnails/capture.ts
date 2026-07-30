export type ThumbnailCaptureErrorCode =
  | 'font-timeout'
  | 'asset-timeout'
  | 'asset-load'
  | 'serialization'
  | 'svg-render'
  | 'canvas-security'
  | 'webp-encoding'

export class ThumbnailCaptureError extends Error {
  override readonly name = 'ThumbnailCaptureError'

  constructor(
    readonly code: ThumbnailCaptureErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export type ThumbnailCaptureRuntime = {
  waitForFonts(timeoutMs: number): Promise<void>
  waitForAssets(element: Element, timeoutMs: number): Promise<void>
  serializeElement(element: Element, width: number, height: number): string
  rasterizeSvg(svg: string, width: number, height: number, quality: number): Promise<Blob>
}

export type ThumbnailCaptureOptions = {
  width?: number
  height?: number
  quality?: number
  timeoutMs?: number
}

function timeout<T>(promise: Promise<T>, timeoutMs: number, error: ThumbnailCaptureError): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(error), timeoutMs)
    promise.then(
      value => {
        window.clearTimeout(timer)
        resolve(value)
      },
      reason => {
        window.clearTimeout(timer)
        reject(reason)
      },
    )
  })
}

function copyComputedStyles(source: Element, target: Element): void {
  const computed = window.getComputedStyle(source)
  const css = Array.from(computed)
    .map(property => `${property}:${computed.getPropertyValue(property)};`)
    .join('')
  target.setAttribute('style', `${target.getAttribute('style') ?? ''};${css}`)

  const sourceChildren = Array.from(source.children)
  const targetChildren = Array.from(target.children)
  sourceChildren.forEach((child, index) => {
    const targetChild = targetChildren[index]
    if (targetChild) copyComputedStyles(child, targetChild)
  })
}

function canvasElements(element: Element): HTMLCanvasElement[] {
  const descendants = Array.from(element.querySelectorAll('canvas')) as HTMLCanvasElement[]
  return element.tagName.toLowerCase() === 'canvas' ? [element as HTMLCanvasElement, ...descendants] : descendants
}

function canvasSnapshotDataUrl(canvas: HTMLCanvasElement): string {
  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new ThumbnailCaptureError('serialization', 'Dashboard canvas has no drawable pixel area')
  }

  try {
    const dataUrl = canvas.toDataURL('image/png')
    if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length <= 'data:image/png;base64,'.length) {
      throw new ThumbnailCaptureError('serialization', 'Dashboard canvas produced an empty pixel snapshot')
    }
    return dataUrl
  } catch (error) {
    if (error instanceof ThumbnailCaptureError) throw error
    if (error instanceof DOMException && error.name === 'SecurityError') {
      throw new ThumbnailCaptureError(
        'canvas-security',
        'Cross-origin canvas content prevented thumbnail serialization',
        { cause: error },
      )
    }
    throw error
  }
}

function replaceCanvasSnapshots(source: Element, clone: Element): Element {
  const sourceCanvases = canvasElements(source)
  const clonedCanvases = canvasElements(clone)
  if (sourceCanvases.length !== clonedCanvases.length) {
    throw new ThumbnailCaptureError('serialization', 'Dashboard canvas tree changed during serialization')
  }

  let replacementRoot = clone
  sourceCanvases.forEach((canvas, index) => {
    const clonedCanvas = clonedCanvases[index]
    if (!clonedCanvas) {
      throw new ThumbnailCaptureError('serialization', 'Dashboard canvas clone is missing')
    }

    const image = clonedCanvas.ownerDocument.createElement('img')
    for (const attribute of Array.from(clonedCanvas.attributes)) {
      if (attribute.name !== 'width' && attribute.name !== 'height') {
        image.setAttribute(attribute.name, attribute.value)
      }
    }
    image.setAttribute('width', String(canvas.width))
    image.setAttribute('height', String(canvas.height))
    image.setAttribute('src', canvasSnapshotDataUrl(canvas))
    image.setAttribute('data-thumbnail-canvas-snapshot', '')
    if (clonedCanvas === clone) replacementRoot = image
    else clonedCanvas.replaceWith(image)
  })
  return replacementRoot
}

function elementSize(element: Element, fallbackWidth: number, fallbackHeight: number) {
  const htmlElement = element as HTMLElement
  const bounds = element.getBoundingClientRect()
  return {
    width: htmlElement.scrollWidth || htmlElement.clientWidth || bounds.width || fallbackWidth,
    height: htmlElement.scrollHeight || htmlElement.clientHeight || bounds.height || fallbackHeight,
  }
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ThumbnailCaptureError('svg-render', 'Browser could not render the serialized dashboard SVG'))
    }
    image.src = url
  })
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        blob => {
          if (blob) resolve(blob)
          else reject(new ThumbnailCaptureError('webp-encoding', 'Browser could not encode a WebP thumbnail'))
        },
        'image/webp',
        quality,
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        reject(
          new ThumbnailCaptureError('canvas-security', 'Cross-origin content prevented thumbnail encoding', {
            cause: error,
          }),
        )
        return
      }
      reject(error)
    }
  })
}

export const browserThumbnailCaptureRuntime: ThumbnailCaptureRuntime = {
  async waitForFonts(timeoutMs) {
    const fonts = document.fonts
    if (!fonts) return
    await timeout(
      fonts.ready.then(() => undefined),
      timeoutMs,
      new ThumbnailCaptureError('font-timeout', 'Timed out waiting for dashboard fonts'),
    )
  },

  async waitForAssets(element, timeoutMs) {
    const images = Array.from(element.querySelectorAll('img'))
    const pending = images.map(async image => {
      if (image.complete) {
        if (image.naturalWidth > 0) return
        throw new ThumbnailCaptureError(
          'asset-load',
          `Dashboard image failed to load: ${image.currentSrc || image.src}`,
        )
      }
      if (typeof image.decode === 'function') {
        try {
          await image.decode()
          return
        } catch (error) {
          throw new ThumbnailCaptureError(
            'asset-load',
            `Dashboard image failed to decode: ${image.currentSrc || image.src}`,
            { cause: error },
          )
        }
      }
      await new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener(
          'error',
          () => reject(new ThumbnailCaptureError('asset-load', `Dashboard image failed to load: ${image.src}`)),
          { once: true },
        )
      })
    })
    await timeout(
      Promise.all(pending).then(() => undefined),
      timeoutMs,
      new ThumbnailCaptureError('asset-timeout', 'Timed out waiting for dashboard assets'),
    )
  },

  serializeElement(element, width, height) {
    try {
      const sourceSize = elementSize(element, width, height)
      const scale = Math.min(width / sourceSize.width, height / sourceSize.height)
      const offsetX = (width - sourceSize.width * scale) / 2
      const offsetY = (height - sourceSize.height * scale) / 2
      const styledClone = element.cloneNode(true) as Element
      copyComputedStyles(element, styledClone)
      const clone = replaceCanvasSnapshots(element, styledClone)
      const serialized = new XMLSerializer().serializeToString(clone)
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#000"/><foreignObject x="${offsetX}" y="${offsetY}" width="${sourceSize.width * scale}" height="${sourceSize.height * scale}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${sourceSize.width}px;height:${sourceSize.height}px;transform:scale(${scale});transform-origin:top left">${serialized}</div></foreignObject></svg>`
    } catch (error) {
      if (error instanceof ThumbnailCaptureError) throw error
      throw new ThumbnailCaptureError('serialization', 'Could not serialize the dashboard renderer DOM', {
        cause: error,
      })
    }
  },

  async rasterizeSvg(svg, width, height, quality) {
    const image = await blobToImage(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new ThumbnailCaptureError('webp-encoding', 'Canvas 2D is unavailable')
    }
    try {
      context.drawImage(image, 0, 0, width, height)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        throw new ThumbnailCaptureError('canvas-security', 'Cross-origin content prevented thumbnail capture', {
          cause: error,
        })
      }
      throw error
    }
    return canvasToWebp(canvas, quality)
  },
}

export async function captureElementToWebp(
  element: Element,
  options: ThumbnailCaptureOptions = {},
  runtime: ThumbnailCaptureRuntime = browserThumbnailCaptureRuntime,
): Promise<Blob> {
  const width = options.width ?? 960
  const height = options.height ?? 540
  const quality = options.quality ?? 0.82
  const timeoutMs = options.timeoutMs ?? 4_000

  try {
    await runtime.waitForFonts(timeoutMs)
    await runtime.waitForAssets(element, timeoutMs)
    const svg = runtime.serializeElement(element, width, height)
    return await runtime.rasterizeSvg(svg, width, height, quality)
  } catch (error) {
    if (error instanceof ThumbnailCaptureError) throw error
    if (error instanceof DOMException && error.name === 'SecurityError') {
      throw new ThumbnailCaptureError('canvas-security', 'Cross-origin content prevented thumbnail capture', {
        cause: error,
      })
    }
    throw new ThumbnailCaptureError('svg-render', 'Thumbnail capture failed', { cause: error })
  }
}
