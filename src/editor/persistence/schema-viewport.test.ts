import type { ProjectSchema } from '@easy-editor/core'
import { describe, expect, it } from 'vitest'

import { getViewportFromSchema } from './schema-viewport'

function schemaWithResolution(width: unknown, height: unknown): ProjectSchema {
  return {
    version: '1.0.0',
    componentsTree: [
      {
        componentName: 'Root',
        $dashboard: {
          rect: {
            x: 0,
            y: 0,
            width,
            height,
          },
        },
      },
    ],
  } as ProjectSchema
}

describe('getViewportFromSchema', () => {
  it('uses the current project root resolution', () => {
    expect(getViewportFromSchema(schemaWithResolution(1377, 811))).toEqual({
      width: 1377,
      height: 811,
    })
  })

  it('falls back when a stored dimension is invalid', () => {
    expect(getViewportFromSchema(schemaWithResolution(-1, Number.NaN))).toEqual({
      width: 1920,
      height: 1080,
    })
  })
})
