import type { ProjectSchema } from '@easy-editor/core'

const DEFAULT_VIEWPORT = {
  width: 1920,
  height: 1080,
}

function normalizeDimension(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.round(value)
}

export function getViewportFromSchema(schema: ProjectSchema) {
  const rect = schema.componentsTree[0]?.$dashboard?.rect

  return {
    width: normalizeDimension(rect?.width, DEFAULT_VIEWPORT.width),
    height: normalizeDimension(rect?.height, DEFAULT_VIEWPORT.height),
  }
}
