import { describe, expect, it } from 'vitest'
import { decideAutoThumbnailRun, resolveThumbnailRetryAction } from './controller'

describe('decideAutoThumbnailRun', () => {
  it('runs once for each clean saved draft version in auto mode', () => {
    expect(
      decideAutoThumbnailRun({
        mode: 'auto',
        saveStatus: 'saved',
        draftVersion: 7,
        lastAttemptedVersion: 6,
      }),
    ).toEqual({ run: true, draftVersion: 7 })
    expect(
      decideAutoThumbnailRun({
        mode: 'auto',
        saveStatus: 'idle',
        draftVersion: 7,
        lastAttemptedVersion: 7,
      }),
    ).toEqual({ run: false })
  })

  it('never captures dirty, saving, failed, conflicting, or custom drafts', () => {
    for (const saveStatus of ['dirty', 'saving', 'error', 'conflict'] as const) {
      expect(
        decideAutoThumbnailRun({
          mode: 'auto',
          saveStatus,
          draftVersion: 8,
          lastAttemptedVersion: null,
        }),
      ).toEqual({ run: false })
    }
    expect(
      decideAutoThumbnailRun({
        mode: 'custom',
        saveStatus: 'saved',
        draftVersion: 8,
        lastAttemptedVersion: null,
      }),
    ).toEqual({ run: false })
  })

  it('allows an explicit regenerate or switch-to-auto action at the current clean version', () => {
    expect(
      decideAutoThumbnailRun({
        mode: 'auto',
        saveStatus: 'saved',
        draftVersion: 9,
        lastAttemptedVersion: 9,
        force: true,
      }),
    ).toEqual({ run: true, draftVersion: 9 })
  })
})

describe('resolveThumbnailRetryAction', () => {
  it('does not silently replace a custom thumbnail with an automatic capture after reload', () => {
    expect(resolveThumbnailRetryAction('custom', false)).toBe('select-custom-file')
    expect(resolveThumbnailRetryAction('custom', true)).toBe('retry-custom')
    expect(resolveThumbnailRetryAction('auto', false)).toBe('retry-auto')
  })
})
