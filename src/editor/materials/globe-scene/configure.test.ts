import { describe, expect, it, vi } from 'vitest'

vi.mock('@easy-editor/plugin-dashboard', () => ({ updateNodeRect: vi.fn() }))

import { components } from '../component'
import { componentMetaMap } from '../meta'
import configure from './configure'

const collectFields = (items: any[] = []): any[] =>
  items.flatMap(item => [item, ...(Array.isArray(item.items) ? collectFields(item.items) : [])])

describe('GlobeScene configure and registration', () => {
  it('is registered in both local runtime directories', () => {
    expect(components.GlobeScene).toBeDefined()
    expect(componentMetaMap.GlobeScene).toMatchObject({
      componentName: 'GlobeScene',
      title: '全球地球场景',
    })
  })

  it('declares all strict GlobeScene and shared Agent fields', () => {
    const capabilities = collectFields(configure.props)
      .map(field => field.extraProps?.agent)
      .filter(capability => capability?.fieldId)
    const fieldIds = capabilities.map(capability => capability.fieldId)

    expect(fieldIds).toEqual(
      expect.arrayContaining([
        'globeScene.background',
        'globeScene.starDensity',
        'globeScene.oceanColor',
        'globeScene.landColor',
        'globeScene.atmosphereColor',
        'globeScene.surfaceBrightness',
        'globeScene.ambientLight',
        'globeScene.daylightIntensity',
        'globeScene.lightAzimuth',
        'globeScene.autoRotate',
        'globeScene.rotationSpeed',
        'globeScene.introAnimation',
        'globeScene.introDuration',
        'globeScene.introLoop',
        'globeScene.centerLongitude',
        'globeScene.centerLatitude',
        'globeScene.globeScale',
        'globeScene.markers',
        'shared.rect',
        'shared.title',
        'shared.visibility',
      ]),
    )
    expect(new Set(fieldIds).size).toBe(fieldIds.length)
    const markerField = capabilities.find(capability => capability.fieldId === 'globeScene.markers')
    expect(markerField?.valueSchema).toMatchObject({
      type: 'array',
      maxItems: 24,
      items: {
        additionalProperties: false,
        required: ['longitude', 'latitude'],
      },
    })
    const backgroundField = capabilities.find(capability => capability.fieldId === 'globeScene.background')
    const shaderColorFields = ['globeScene.oceanColor', 'globeScene.landColor', 'globeScene.atmosphereColor'].map(
      fieldId => capabilities.find(capability => capability.fieldId === fieldId),
    )
    expect(backgroundField?.valueSchema.maxLength).toBe(64)
    expect(shaderColorFields.map(field => field?.valueSchema.maxLength)).toEqual([9, 9, 9])
    for (const capability of capabilities) {
      expect(capability).toMatchObject({
        access: 'read-write',
        readPath: expect.any(Array),
        valueSchema: expect.any(Object),
        verifyPaths: expect.any(Array),
        writeTargets: expect.any(Array),
      })
    }
  })

  it('ships every runtime asset required by the local GlobeScene', async () => {
    const { readFile } = await import('node:fs/promises')
    const runtimeUrl = new URL('./', import.meta.url)

    for (const file of [
      'component.tsx',
      'component.css',
      'configure.ts',
      'spec.ts',
      'webgl.ts',
      'world.geo.json',
      'assets/earth-blue-marble.jpg',
      'assets/2mass-galactic-plane.jpg',
      'assets/SOURCES.md',
    ]) {
      const runtime = await readFile(new URL(file, runtimeUrl))
      expect(runtime.byteLength, file).toBeGreaterThan(0)
    }
  })
})
