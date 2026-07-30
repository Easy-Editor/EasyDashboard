import type { ProjectSchema } from '@easy-editor/core'
import { parseCanvasDimension } from './canvas-resolution'

export const CANVAS_RESOLUTION_PRESETS = [
  { value: 'hd', label: 'HD', width: 1280, height: 720 },
  { value: 'fhd', label: 'FHD', width: 1920, height: 1080 },
  { value: '2k', label: '2K', width: 2560, height: 1440 },
  { value: '4k', label: '4K', width: 3840, height: 2160 },
] as const

export type CanvasResolutionPreset = (typeof CANVAS_RESOLUTION_PRESETS)[number]['value'] | 'custom'

export type CanvasResolution = {
  width: number
  height: number
}

export function resolveCanvasResolution(
  preset: CanvasResolutionPreset,
  customWidth: string,
  customHeight: string,
): CanvasResolution {
  if (preset === 'custom') {
    return {
      width: parseCanvasDimension(customWidth, '画布宽度'),
      height: parseCanvasDimension(customHeight, '画布高度'),
    }
  }

  const resolution = CANVAS_RESOLUTION_PRESETS.find(item => item.value === preset)
  if (!resolution) throw new Error('请选择画布分辨率')
  return { width: resolution.width, height: resolution.height }
}

export function createProjectSchemaWithResolution(
  template: ProjectSchema,
  resolution: CanvasResolution,
): ProjectSchema {
  const schema = structuredClone(template)
  const homePage = schema.componentsTree[0]
  if (!homePage) throw new Error('默认项目缺少首页')

  homePage.$dashboard = {
    ...homePage.$dashboard,
    rect: {
      ...homePage.$dashboard?.rect,
      width: resolution.width,
      height: resolution.height,
    },
  }
  return schema
}
