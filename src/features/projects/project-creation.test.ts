import { defaultProjectSchema } from '@/editor/const'
import { describe, expect, it } from 'vitest'

import {
  CANVAS_RESOLUTION_PRESETS,
  createProjectSchemaWithResolution,
  resolveCanvasResolution,
} from './project-creation'

describe('project creation resolution', () => {
  it('offers HD, FHD, 2K, and 4K presets with FHD as the default', () => {
    expect(CANVAS_RESOLUTION_PRESETS).toEqual([
      { value: 'hd', label: 'HD', width: 1280, height: 720 },
      { value: 'fhd', label: 'FHD', width: 1920, height: 1080 },
      { value: '2k', label: '2K', width: 2560, height: 1440 },
      { value: '4k', label: '4K', width: 3840, height: 2160 },
    ])
    expect(resolveCanvasResolution('fhd', '', '')).toEqual({ width: 1920, height: 1080 })
  })

  it('accepts a positive integer custom resolution', () => {
    expect(resolveCanvasResolution('custom', '3440', '1440')).toEqual({ width: 3440, height: 1440 })
    expect(() => resolveCanvasResolution('custom', '0', '1080')).toThrow('画布宽度必须是正整数')
    expect(() => resolveCanvasResolution('custom', '1920.5', '1080')).toThrow('画布宽度必须是正整数')
    expect(() => resolveCanvasResolution('custom', '9007199254740992', '1080')).toThrow('画布宽度必须是正整数')
    expect(() => resolveCanvasResolution('custom', '16385', '1080')).toThrow('画布宽度不能超过 16384')
  })

  it('writes the selected resolution into a cloned default schema home page', () => {
    const schema = createProjectSchemaWithResolution(defaultProjectSchema, { width: 2560, height: 1440 })

    expect(schema).not.toBe(defaultProjectSchema)
    expect(schema.componentsTree[0]).not.toBe(defaultProjectSchema.componentsTree[0])
    expect(schema.componentsTree[0]?.$dashboard?.rect).toMatchObject({
      x: 0,
      y: 0,
      width: 2560,
      height: 1440,
    })
    expect(defaultProjectSchema.componentsTree[0]?.$dashboard?.rect).toMatchObject({
      width: 1920,
      height: 1080,
    })
  })
})
