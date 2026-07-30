import type { ThumbnailStatus } from './state'

export type ThumbnailStatusSemantics = {
  label: string
  ariaLive: 'off' | 'polite' | 'assertive'
  busy: boolean
  animation: 'none' | 'pulse'
}

const labels: Record<ThumbnailStatus, string> = {
  queued: 'Thumbnail queued',
  rendering: 'Generating thumbnail',
  ready: 'Thumbnail ready',
  failed: 'Thumbnail generation failed',
}

export function getThumbnailStatusSemantics(
  status: ThumbnailStatus,
  prefersReducedMotion: boolean,
): ThumbnailStatusSemantics {
  const busy = status === 'queued' || status === 'rendering'
  return {
    label: labels[status],
    ariaLive: status === 'failed' ? 'assertive' : busy ? 'polite' : 'off',
    busy,
    animation: busy && !prefersReducedMotion ? 'pulse' : 'none',
  }
}
