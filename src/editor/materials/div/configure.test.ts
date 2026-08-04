import { describe, expect, it, vi } from 'vitest'

vi.mock('@easy-editor/plugin-dashboard', () => ({ updateNodeRect: vi.fn() }))

import configure from './configure'

const collectFields = (items: any[] = []): any[] =>
  items.flatMap(item => [item, ...(Array.isArray(item.items) ? collectFields(item.items) : [])])

describe('Div configure', () => {
  it('is a container with all style and shared Agent fields', () => {
    const fields = collectFields(configure.props)
    const fieldByName = (name: string) => fields.find(field => field.name === name)

    expect(configure.component?.isContainer).toBe(true)
    expect(fields.map(field => field.name).filter(Boolean)).toEqual(
      expect.arrayContaining([
        'background',
        'borderColor',
        'borderWidth',
        'borderRadius',
        'opacity',
        'panelShape',
        'panelInset',
        'visualPreset',
        'enterAnimation',
        'enterDuration',
        'enterDelay',
        'overflow',
        'shadowColor',
        'shadowBlur',
        'shadowOffsetY',
      ]),
    )
    expect(fieldByName('title')?.extraProps?.agent?.fieldId).toBe('shared.title')
    expect(fieldByName('rect')?.extraProps?.agent?.fieldId).toBe('shared.rect')
    expect(fieldByName('condition')?.extraProps?.agent?.fieldId).toBe('shared.visibility')
  })

  it('compiles callback-backed shared fields into the safe Agent manifest', async () => {
    const manifestModulePath = new URL(
      '../../../../../EasyEditor/examples/dashboard/src/editor/agent/manifest/index.mjs',
      import.meta.url,
    ).href
    const { compileSafeMaterialManifest } = await import(/* @vite-ignore */ manifestModulePath)
    const manifest = compileSafeMaterialManifest({
      materialRegistryVersion: 1,
      metadata: { componentName: 'Div', configure },
    })
    const fieldIds = manifest.fields.map((field: { fieldId: string }) => field.fieldId)

    expect(fieldIds).toEqual(
      expect.arrayContaining([
        'shared.title',
        'shared.rect',
        'shared.visibility',
        'props.background',
        'props.borderColor',
        'props.borderWidth',
        'props.borderRadius',
        'props.opacity',
        'props.overflow',
        'props.shadowColor',
        'props.shadowBlur',
        'props.shadowOffsetY',
        'div.panelShape',
        'div.panelInset',
        'div.visualPreset',
        'div.enterAnimation',
        'div.enterDuration',
        'div.enterDelay',
      ]),
    )
    expect(manifest.diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).not.toContain(
      'ambiguous-field-binding',
    )
    expect(manifest.diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).not.toContain(
      'callback-annotation-required',
    )
    expect(manifest.readiness.status).toBe('ready')
  })
})
