import { describe, expect, it } from 'vitest'
import { generateViewportBlueprint } from './viewport-blueprint'

describe('generateViewportBlueprint', () => {
  it('uses the configured start page and deterministically projects component rectangles', () => {
    const document = {
      editorSchema: {
        componentsTree: [
          {
            componentName: 'Root',
            fileName: 'other',
            meta: { easyDashboard: { pageId: 'page-other' } },
            $dashboard: { rect: { width: 100, height: 100 } },
          },
          {
            componentName: 'Root',
            fileName: 'overview',
            meta: { easyDashboard: { pageId: 'page-overview' } },
            props: { backgroundColor: '#081018' },
            $dashboard: { rect: { width: 1920, height: 1080 } },
            children: [
              {
                id: 'sales',
                componentName: 'Chart',
                $dashboard: { rect: { x: 96, y: 108, width: 864, height: 432 } },
              },
              {
                id: 'kpi',
                componentName: 'Statistic',
                $dashboard: { rect: { x: 1056, y: 108, width: 768, height: 216 } },
              },
            ],
          },
        ],
      },
      presentation: { startPageId: 'page-overview' },
    }

    const first = generateViewportBlueprint(document)
    const second = generateViewportBlueprint(structuredClone(document))

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      width: 960,
      height: 540,
      sourceViewport: { width: 1920, height: 1080 },
    })
    expect(first.svg).toContain('viewBox="0 0 1920 1080"')
    expect(first.svg).toContain('x="96" y="108" width="864" height="432"')
    expect(first.svg).toContain('x="1056" y="108" width="768" height="216"')
    expect(first.dataUrl).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(first.svg)}`)
  })

  it('falls back to a valid empty 16:9 blueprint for malformed schema input', () => {
    const result = generateViewportBlueprint(null)

    expect(result.sourceViewport).toEqual({ width: 1920, height: 1080 })
    expect(result.svg).toContain('No components')
  })
})
