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

  it('compiles all strict GlobeScene and shared fields into the Agent manifest', async () => {
    const manifestModulePath = new URL(
      '../../../../../EasyEditor/examples/dashboard/src/editor/agent/manifest/index.mjs',
      import.meta.url,
    ).href
    const { compileSafeMaterialManifest } = await import(/* @vite-ignore */ manifestModulePath)
    const screenContractModulePath = new URL(
      '../../../../../EasyEditor/examples/dashboard/src/editor/agent/capabilities/screen/contract.mjs',
      import.meta.url,
    ).href
    const { DEFAULT_SCREEN_CHANGESET_LIMITS, validateValueSchema } = await import(
      /* @vite-ignore */ screenContractModulePath
    )
    const manifest = compileSafeMaterialManifest({
      materialRegistryVersion: 1,
      metadata: { componentName: 'GlobeScene', configure },
    })
    const fieldIds = manifest.fields.map((field: { fieldId: string }) => field.fieldId)

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
    const markerField = manifest.fields.find((field: { fieldId: string }) => field.fieldId === 'globeScene.markers')
    expect(markerField.valueSchema).toMatchObject({
      type: 'array',
      maxItems: 24,
      items: {
        additionalProperties: false,
        required: ['longitude', 'latitude'],
      },
    })
    const backgroundField = manifest.fields.find(
      (field: { fieldId: string }) => field.fieldId === 'globeScene.background',
    )
    const shaderColorFields = ['globeScene.oceanColor', 'globeScene.landColor', 'globeScene.atmosphereColor'].map(
      fieldId => manifest.fields.find((field: { fieldId: string }) => field.fieldId === fieldId),
    )
    expect(backgroundField.valueSchema.maxLength).toBe(64)
    expect(shaderColorFields.map(field => field.valueSchema.maxLength)).toEqual([9, 9, 9])
    expect(() =>
      validateValueSchema(
        '#020814',
        backgroundField.valueSchema,
        'operations[0].value',
        DEFAULT_SCREEN_CHANGESET_LIMITS,
      ),
    ).not.toThrow()
    expect(() =>
      validateValueSchema(
        [{ longitude: 116.4, latitude: 39.9, label: '北京', color: '#61e9ff', value: '96' }],
        markerField.valueSchema,
        'operations[0].value',
        DEFAULT_SCREEN_CHANGESET_LIMITS,
      ),
    ).not.toThrow()
    expect(manifest.diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).toEqual([
      'advanced-presentation-excluded',
    ])
    expect(manifest.readiness.status).toBe('ready')
  })

  it('keeps the source-of-truth and runtime mirror synchronized', async () => {
    const { readFile } = await import('node:fs/promises')
    const sourceUrl = new URL(
      '../../../../../EasyEditor/examples/dashboard/src/editor/materials/inner/globe-scene/',
      import.meta.url,
    )
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
      const [source, runtime] = await Promise.all([
        readFile(new URL(file, sourceUrl)),
        readFile(new URL(file, runtimeUrl)),
      ])
      expect(runtime.equals(source)).toBe(true)
    }
  })
})
