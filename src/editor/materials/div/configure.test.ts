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

  it('declares a complete, unambiguous Agent field contract', () => {
    const capabilities = collectFields(configure.props)
      .map(field => field.extraProps?.agent)
      .filter(capability => capability?.fieldId)
    const fieldIds = capabilities.map(capability => capability.fieldId)

    expect(fieldIds).toEqual(
      expect.arrayContaining([
        'shared.title',
        'shared.rect',
        'shared.visibility',
        'div.panelShape',
        'div.panelInset',
        'div.visualPreset',
        'div.enterAnimation',
        'div.enterDuration',
        'div.enterDelay',
      ]),
    )
    expect(new Set(fieldIds).size).toBe(fieldIds.length)
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
})
