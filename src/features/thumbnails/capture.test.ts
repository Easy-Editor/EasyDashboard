import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ThumbnailCaptureError,
  type ThumbnailCaptureRuntime,
  browserThumbnailCaptureRuntime,
  captureElementToWebp,
} from './capture'

type FakeAttribute = { name: string; value: string }

class FakeElement {
  readonly attributes: FakeAttribute[] = []
  readonly children: FakeElement[] = []
  parent: FakeElement | undefined
  scrollWidth = 0
  scrollHeight = 0
  clientWidth = 0
  clientHeight = 0

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  append(...children: FakeElement[]) {
    for (const child of children) {
      child.parent = this
      this.children.push(child)
    }
  }

  setAttribute(name: string, value: string) {
    const existing = this.attributes.find(attribute => attribute.name === name)
    if (existing) existing.value = value
    else this.attributes.push({ name, value })
  }

  getAttribute(name: string) {
    return this.attributes.find(attribute => attribute.name === name)?.value ?? null
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap(child => [
      ...(child.tagName.toLowerCase() === selector ? [child] : []),
      ...child.querySelectorAll(selector),
    ])
  }

  cloneNode(deep: boolean): FakeElement {
    const clone =
      this instanceof FakeCanvas
        ? new FakeCanvas(this.ownerDocument, this.width, this.height)
        : new FakeElement(this.tagName, this.ownerDocument)
    for (const attribute of this.attributes) clone.setAttribute(attribute.name, attribute.value)
    clone.scrollWidth = this.scrollWidth
    clone.scrollHeight = this.scrollHeight
    clone.clientWidth = this.clientWidth
    clone.clientHeight = this.clientHeight
    if (deep) clone.append(...this.children.map(child => child.cloneNode(true)))
    return clone
  }

  replaceWith(replacement: FakeElement) {
    if (!this.parent) return
    const index = this.parent.children.indexOf(this)
    replacement.parent = this.parent
    this.parent.children[index] = replacement
    this.parent = undefined
  }

  getBoundingClientRect() {
    return { width: this.clientWidth, height: this.clientHeight }
  }
}

class FakeCanvas extends FakeElement {
  private readonly pixels: Uint8Array
  private fill = [0, 0, 0, 0] as [number, number, number, number]

  constructor(
    ownerDocument: FakeDocument,
    readonly width: number,
    readonly height: number,
  ) {
    super('CANVAS', ownerDocument)
    this.pixels = new Uint8Array(width * height * 4)
  }

  getContext(kind: string) {
    if (kind !== '2d') return null
    const thisCanvas = this
    return {
      set fillStyle(value: string) {
        const colors: Record<string, [number, number, number, number]> = {
          red: [255, 0, 0, 255],
          green: [0, 128, 0, 255],
        }
        thisCanvas.fill = colors[value] ?? [0, 0, 0, 255]
      },
      fillRect: (x: number, y: number, width: number, height: number) => {
        for (let row = y; row < y + height; row += 1) {
          for (let column = x; column < x + width; column += 1) {
            this.pixels.set(this.fill, (row * this.width + column) * 4)
          }
        }
      },
    }
  }

  toDataURL() {
    return `data:image/png;base64,${Buffer.from(this.pixels).toString('base64')}`
  }
}

class TaintedFakeCanvas extends FakeCanvas {
  override toDataURL(): string {
    throw new DOMException('The canvas has been tainted', 'SecurityError')
  }
}

class EmptyFakeCanvas extends FakeCanvas {
  override toDataURL(): string {
    return 'data:image/png;base64,'
  }
}

class FakeDocument {
  createElement(tagName: string) {
    return new FakeElement(tagName.toUpperCase(), this)
  }
}

function serializeFakeElement(element: FakeElement): string {
  const attributes = element.attributes.map(attribute => ` ${attribute.name}="${attribute.value}"`).join('')
  const children = element.children.map(serializeFakeElement).join('')
  return `<${element.tagName.toLowerCase()}${attributes}>${children}</${element.tagName.toLowerCase()}>`
}

describe('captureElementToWebp', () => {
  const originalWindow = globalThis.window
  const originalXmlSerializer = globalThis.XMLSerializer

  beforeEach(() => {
    Object.assign(globalThis, {
      window: {
        getComputedStyle: () => ({
          *[Symbol.iterator]() {
            yield 'position'
            yield 'width'
            yield 'height'
          },
          getPropertyValue: (property: string) =>
            ({ position: 'absolute', width: '2px', height: '1px' })[property] ?? '',
        }),
      },
      XMLSerializer: class {
        serializeToString(element: FakeElement) {
          return serializeFakeElement(element)
        }
      },
    })
  })

  afterEach(() => {
    Object.assign(globalThis, {
      window: originalWindow,
      XMLSerializer: originalXmlSerializer,
    })
  })

  it('waits for fonts/assets and encodes a 960x540 WebP at quality .82', async () => {
    const blob = new Blob(['webp'], { type: 'image/webp' })
    const runtime: ThumbnailCaptureRuntime = {
      waitForFonts: vi.fn().mockResolvedValue(undefined),
      waitForAssets: vi.fn().mockResolvedValue(undefined),
      serializeElement: vi.fn().mockReturnValue('<svg/>'),
      rasterizeSvg: vi.fn().mockResolvedValue(blob),
    }
    const element = {} as Element

    await expect(captureElementToWebp(element, {}, runtime)).resolves.toBe(blob)
    expect(runtime.waitForFonts).toHaveBeenCalledWith(4_000)
    expect(runtime.waitForAssets).toHaveBeenCalledWith(element, 4_000)
    expect(runtime.serializeElement).toHaveBeenCalledWith(element, 960, 540)
    expect(runtime.rasterizeSvg).toHaveBeenCalledWith('<svg/>', 960, 540, 0.82)
  })

  it('surfaces CORS/security failures with a stable capture error code', async () => {
    const runtime: ThumbnailCaptureRuntime = {
      waitForFonts: vi.fn().mockResolvedValue(undefined),
      waitForAssets: vi.fn().mockResolvedValue(undefined),
      serializeElement: vi.fn().mockReturnValue('<svg/>'),
      rasterizeSvg: vi.fn().mockRejectedValue(new DOMException('The canvas has been tainted', 'SecurityError')),
    }

    await expect(captureElementToWebp({} as Element, {}, runtime)).rejects.toMatchObject({
      name: 'ThumbnailCaptureError',
      code: 'canvas-security',
    } satisfies Partial<ThumbnailCaptureError>)
  })

  it('serializes the current pixels of a drawn canvas into an image snapshot', () => {
    const ownerDocument = new FakeDocument()
    const root = new FakeElement('DIV', ownerDocument)
    root.scrollWidth = 2
    root.scrollHeight = 1
    const canvas = new FakeCanvas(ownerDocument, 2, 1)
    canvas.setAttribute('class', 'chart-layer')
    root.append(canvas)

    const context = canvas.getContext('2d')
    expect(context).not.toBeNull()
    if (!context) return
    context.fillStyle = 'red'
    context.fillRect(0, 0, 1, 1)
    context.fillStyle = 'green'
    context.fillRect(1, 0, 1, 1)

    const svg = browserThumbnailCaptureRuntime.serializeElement(root as unknown as Element, 960, 540)
    const snapshot = svg.match(/src="data:image\/png;base64,([^"]+)"/)?.[1]

    expect(svg).not.toContain('<canvas')
    expect(svg).toContain('data-thumbnail-canvas-snapshot=""')
    expect(svg).toContain('class="chart-layer"')
    expect(svg).toContain('style=";position:absolute;width:2px;height:1px;"')
    expect(snapshot).toBeTruthy()
    expect(Array.from(Buffer.from(snapshot ?? '', 'base64'))).toEqual([255, 0, 0, 255, 0, 128, 0, 255])
  })

  it('surfaces a tainted serialized canvas as canvas-security for blueprint fallback', () => {
    const ownerDocument = new FakeDocument()
    const root = new FakeElement('DIV', ownerDocument)
    root.scrollWidth = 2
    root.scrollHeight = 1
    root.append(new TaintedFakeCanvas(ownerDocument, 2, 1))

    expect(() => browserThumbnailCaptureRuntime.serializeElement(root as unknown as Element, 960, 540)).toThrowError(
      expect.objectContaining({
        name: 'ThumbnailCaptureError',
        code: 'canvas-security',
      }),
    )
  })

  it('rejects an empty canvas snapshot instead of serializing a blank image', () => {
    const ownerDocument = new FakeDocument()
    const root = new FakeElement('DIV', ownerDocument)
    root.scrollWidth = 2
    root.scrollHeight = 1
    root.append(new EmptyFakeCanvas(ownerDocument, 2, 1))

    expect(() => browserThumbnailCaptureRuntime.serializeElement(root as unknown as Element, 960, 540)).toThrowError(
      expect.objectContaining({
        name: 'ThumbnailCaptureError',
        code: 'serialization',
        message: 'Dashboard canvas produced an empty pixel snapshot',
      }),
    )
  })
})
