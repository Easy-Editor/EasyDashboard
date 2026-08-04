import { describe, expect, it } from 'vitest'
import { CdnProviderManager } from './cdn-provider'

describe('CdnProviderManager linked materials', () => {
  it('uses the local ScrollList 0.0.8 UMD route when linked materials are enabled', () => {
    const manager = new CdnProviderManager(undefined, true)

    expect(manager.buildUrl('@easy-editor/materials-dashboard-scroll-list', '0.0.7', 'dist/index.min.js')).toBe(
      '/__easy-dashboard-linked-materials/scroll-list/0.0.8/dist/index.min.js',
    )
  })

  it('uses the local PieChart 0.0.8 UMD route when linked materials are enabled', () => {
    const manager = new CdnProviderManager(undefined, true)

    expect(manager.buildUrl('@easy-editor/materials-dashboard-pie-chart', '0.0.7', 'dist/index.min.js')).toBe(
      '/__easy-dashboard-linked-materials/pie-chart/0.0.8/dist/index.min.js',
    )
  })

  it('keeps CDN URLs as the default and for all non-allowlisted resources', () => {
    const defaultManager = new CdnProviderManager(undefined, false)
    const linkedManager = new CdnProviderManager(undefined, true)

    expect(defaultManager.buildUrl('@easy-editor/materials-dashboard-scroll-list', '0.0.7', 'dist/index.min.js')).toBe(
      'https://unpkg.com/@easy-editor/materials-dashboard-scroll-list@0.0.7/dist/index.min.js',
    )
    expect(linkedManager.buildUrl('@easy-editor/materials-dashboard-text', '0.0.7', 'dist/index.min.js')).toBe(
      'https://unpkg.com/@easy-editor/materials-dashboard-text@0.0.7/dist/index.min.js',
    )
  })
})
