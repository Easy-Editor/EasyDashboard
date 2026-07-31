import { describe, expect, it } from 'vitest'
import { resolvePreviewLoadState } from './preview-load-state'

describe('preview load state', () => {
  it('keeps the loading state retryable', () => {
    expect(resolvePreviewLoadState(null, null)).toEqual({
      status: 'loading',
      canRetry: true,
    })
  })

  it('keeps the API error and exposes a retryable state', () => {
    const error = new Error('草稿接口暂时不可用')

    expect(resolvePreviewLoadState(null, error)).toEqual({
      status: 'error',
      error,
      canRetry: true,
    })
  })

  it('returns the loaded project without a redundant retry action', () => {
    const project = { id: 'project-preview' }

    expect(resolvePreviewLoadState(project, null)).toEqual({
      status: 'ready',
      project,
      canRetry: false,
    })
  })
})
