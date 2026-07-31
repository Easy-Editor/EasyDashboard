export interface FloatingRect {
  left: number
  top: number
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

export function resolveClampedFloatingPosition(
  floating: FloatingRect,
  viewport: ViewportSize,
  inset = 12,
): Pick<FloatingRect, 'left' | 'top'> {
  const maxLeft = Math.max(inset, viewport.width - inset - floating.width)
  const maxTop = Math.max(inset, viewport.height - inset - floating.height)

  return {
    left: Math.min(Math.max(floating.left, inset), maxLeft),
    top: Math.min(Math.max(floating.top, inset), maxTop),
  }
}
