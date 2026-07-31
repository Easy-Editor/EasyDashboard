export const MAX_CANVAS_DIMENSION = 16_384

export function parseCanvasDimension(value: string, label: string): number {
  const dimension = Number(value)
  if (!Number.isSafeInteger(dimension) || dimension <= 0) {
    throw new Error(`${label}必须是正整数`)
  }
  if (dimension > MAX_CANVAS_DIMENSION) {
    throw new Error(`${label}不能超过 ${MAX_CANVAS_DIMENSION}`)
  }
  return dimension
}

export function clampCanvasDimension(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_CANVAS_DIMENSION, Math.max(1, Math.trunc(value)))
}
