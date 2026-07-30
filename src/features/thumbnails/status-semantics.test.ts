import { describe, expect, it } from 'vitest'
import { getThumbnailStatusSemantics } from './status-semantics'

describe('thumbnail status semantics', () => {
  it('announces work without motion when reduced motion is requested', () => {
    expect(getThumbnailStatusSemantics('rendering', true)).toEqual({
      label: 'Generating thumbnail',
      ariaLive: 'polite',
      busy: true,
      animation: 'none',
    })
    expect(getThumbnailStatusSemantics('rendering', false).animation).toBe('pulse')
  })

  it('uses assertive announcement for failure and no animation for terminal states', () => {
    expect(getThumbnailStatusSemantics('failed', false)).toEqual({
      label: 'Thumbnail generation failed',
      ariaLive: 'assertive',
      busy: false,
      animation: 'none',
    })
  })
})
