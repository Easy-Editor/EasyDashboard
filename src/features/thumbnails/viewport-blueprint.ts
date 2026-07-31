const OUTPUT_WIDTH = 960
const OUTPUT_HEIGHT = 540
const DEFAULT_VIEWPORT = { width: 1920, height: 1080 }
const DEFAULT_BACKGROUND = '#0b1118'

type UnknownRecord = Record<string, unknown>

export type ViewportBlueprint = {
  width: typeof OUTPUT_WIDTH
  height: typeof OUTPUT_HEIGHT
  sourceViewport: { width: number; height: number }
  svg: string
  dataUrl: string
}

type BlueprintRect = {
  key: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function safeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const color = value.trim()
  return /^(#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+-]+\))$/i.test(color) ? color : undefined
}

function stableHue(value: string): number {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % 360
}

function selectPage(input: unknown): UnknownRecord | undefined {
  const source = record(input)
  const editorSchema = record(source?.editorSchema) ?? source
  const pages = Array.isArray(editorSchema?.componentsTree)
    ? editorSchema.componentsTree.map(record).filter((page): page is UnknownRecord => !!page)
    : []
  const startPageId = record(source?.presentation)?.startPageId
  if (typeof startPageId !== 'string') return pages[0]

  return pages.find(page => record(record(page.meta)?.easyDashboard)?.pageId === startPageId) ?? pages[0]
}

function collectRects(node: UnknownRecord, path: string, output: BlueprintRect[]): void {
  const rect = record(record(node.$dashboard)?.rect)
  const width = positiveNumber(rect?.width, 0)
  const height = positiveNumber(rect?.height, 0)
  const label =
    (typeof node.componentName === 'string' && node.componentName) ||
    (typeof node.id === 'string' && node.id) ||
    'Component'

  if (width > 0 && height > 0 && node.componentName !== 'Root') {
    output.push({
      key: `${path}:${String(node.id ?? label)}`,
      label,
      x: finiteNumber(rect?.x),
      y: finiteNumber(rect?.y),
      width,
      height,
    })
  }

  if (!Array.isArray(node.children)) return
  node.children.forEach((child, index) => {
    const childRecord = record(child)
    if (childRecord) collectRects(childRecord, `${path}.${index}`, output)
  })
}

export function generateViewportBlueprint(input: unknown): ViewportBlueprint {
  const page = selectPage(input)
  const rootRect = record(record(page?.$dashboard)?.rect)
  const sourceViewport = {
    width: positiveNumber(rootRect?.width, DEFAULT_VIEWPORT.width),
    height: positiveNumber(rootRect?.height, DEFAULT_VIEWPORT.height),
  }
  const background =
    safeColor(record(page?.props)?.backgroundColor) ?? safeColor(record(page?.props)?.background) ?? DEFAULT_BACKGROUND
  const rects: BlueprintRect[] = []
  if (page) collectRects(page, 'root', rects)

  const components =
    rects.length > 0
      ? rects
          .map(item => {
            const hue = stableHue(item.key)
            const labelY = item.y + Math.min(30, Math.max(16, item.height / 2))
            return `<g><rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="10" fill="hsl(${hue} 55% 45% / 0.2)" stroke="hsl(${hue} 72% 68%)" stroke-width="3"/><text x="${item.x + 14}" y="${labelY}" fill="#e5edf5" font-family="system-ui, sans-serif" font-size="22">${escapeXml(item.label)}</text></g>`
          })
          .join('')
      : `<text x="${sourceViewport.width / 2}" y="${sourceViewport.height / 2}" text-anchor="middle" fill="#8190a0" font-family="system-ui, sans-serif" font-size="34">No components</text>`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" viewBox="0 0 ${sourceViewport.width} ${sourceViewport.height}" role="img" aria-label="Dashboard viewport blueprint"><rect width="100%" height="100%" fill="${background}"/><g>${components}</g></svg>`

  return {
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT,
    sourceViewport,
    svg,
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  }
}
