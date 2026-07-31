export const MIN_PREVIEW_SCALE = 0.02
export const MAX_PREVIEW_SCALE = 4
export const PREVIEW_SCALE_STEP = 0.1
export const PREVIEW_FIT_GUTTER = 48

export type PreviewScaleMode = 'fit' | 'manual'

export type PreviewScaleState = {
  mode: PreviewScaleMode
  manualScale: number
}

type Size = {
  width: number
  height: number
}

export function clampPreviewScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, scale))
}

export function calculatePreviewFitScale(container: Size, viewport: Size, gutter = PREVIEW_FIT_GUTTER): number {
  if (container.width <= 0 || container.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1

  const availableWidth = Math.max(1, container.width - gutter)
  const availableHeight = Math.max(1, container.height - gutter)
  return clampPreviewScale(Math.min(availableWidth / viewport.width, availableHeight / viewport.height))
}

export function stepPreviewScale(currentScale: number, direction: -1 | 1): number {
  return clampPreviewScale(currentScale + direction * PREVIEW_SCALE_STEP)
}

export function resolvePreviewScale(state: PreviewScaleState, fitScale: number): number {
  return state.mode === 'fit' ? clampPreviewScale(fitScale) : clampPreviewScale(state.manualScale)
}
