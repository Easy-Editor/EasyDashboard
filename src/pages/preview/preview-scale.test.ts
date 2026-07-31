import { describe, expect, it } from 'vitest'
import {
  MAX_PREVIEW_SCALE,
  MIN_PREVIEW_SCALE,
  calculatePreviewFitScale,
  clampPreviewScale,
  resolvePreviewScale,
  stepPreviewScale,
} from './preview-scale'

describe('preview scale contract', () => {
  it('fits the real project resolution inside the measured preview stage', () => {
    expect(calculatePreviewFitScale({ width: 1440, height: 900 }, { width: 1920, height: 1080 })).toBeCloseTo(0.725, 3)
  })

  it('keeps fit mode live while 100% uses the authored pixel scale', () => {
    expect(resolvePreviewScale({ mode: 'fit', manualScale: 1 }, 0.625)).toBe(0.625)
    expect(resolvePreviewScale({ mode: 'manual', manualScale: 1 }, 0.625)).toBe(1)
  })

  it('steps the displayed scale and clamps extreme resolutions safely', () => {
    expect(stepPreviewScale(0.5, 1)).toBeCloseTo(0.6)
    expect(stepPreviewScale(0.5, -1)).toBeCloseTo(0.4)
    expect(clampPreviewScale(0)).toBe(MIN_PREVIEW_SCALE)
    expect(clampPreviewScale(99)).toBe(MAX_PREVIEW_SCALE)
  })
})
