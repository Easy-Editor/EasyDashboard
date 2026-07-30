import { describe, expect, it } from 'vitest'
import { MAX_CANVAS_DIMENSION, clampCanvasDimension, parseCanvasDimension } from './canvas-resolution'

describe('canvas resolution bounds', () => {
  it('uses the same upper bound for creation and in-editor changes', () => {
    expect(MAX_CANVAS_DIMENSION).toBe(16_384)
    expect(parseCanvasDimension('16384', '宽度')).toBe(16_384)
    expect(() => parseCanvasDimension('16385', '宽度')).toThrow('宽度不能超过 16384')
    expect(clampCanvasDimension(20_000)).toBe(16_384)
  })

  it('normalizes invalid editor input without producing unsafe dimensions', () => {
    expect(clampCanvasDimension(Number.NaN)).toBe(1)
    expect(clampCanvasDimension(-4)).toBe(1)
    expect(clampCanvasDimension(1920.9)).toBe(1920)
  })
})
