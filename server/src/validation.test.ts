import { describe, expect, it } from 'vitest'
import { MAX_CANVAS_DIMENSION, type ValidationError, assertCanvasDimensions } from './validation.js'

describe('assertCanvasDimensions', () => {
  it('accepts raw and enveloped project documents within the supported range', () => {
    expect(() =>
      assertCanvasDimensions({
        componentsTree: [{ $dashboard: { rect: { width: 1920, height: 1080 } } }],
      }),
    ).not.toThrow()

    expect(() =>
      assertCanvasDimensions({
        editorSchema: {
          componentsTree: [{ $dashboard: { rect: { width: MAX_CANVAS_DIMENSION, height: MAX_CANVAS_DIMENSION } } }],
        },
      }),
    ).not.toThrow()
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1920.5],
    ['oversized', MAX_CANVAS_DIMENSION + 1],
    ['not numeric', '1920'],
  ])('rejects %s canvas dimensions', (_label, width) => {
    expect(() =>
      assertCanvasDimensions({
        componentsTree: [{ $dashboard: { rect: { width, height: 1080 } } }],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ValidationError>>({
        code: 'INVALID_CANVAS_DIMENSION',
      }),
    )
  })

  it('keeps legacy pages without an explicit viewport compatible', () => {
    expect(() => assertCanvasDimensions({ componentsTree: [{ componentName: 'Root' }] })).not.toThrow()
  })
})
