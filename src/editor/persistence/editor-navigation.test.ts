import { describe, expect, it } from 'vitest'
import { isEditorPageQueryNavigation, shouldBlockEditorNavigation } from './editor-navigation'

const current = {
  pathname: '/projects/project-1/editor',
  search: '?panel=layers&page=page-home',
  hash: '',
}

describe('editor navigation blocker', () => {
  it('never blocks same-editor page query synchronization, including dirty and conflict states', () => {
    const next = {
      ...current,
      search: '?page=page-details&panel=layers',
    }

    expect(isEditorPageQueryNavigation(current, next)).toBe(true)
    expect(shouldBlockEditorNavigation('dirty', current, next)).toBe(false)
    expect(shouldBlockEditorNavigation('error', current, next)).toBe(false)
    expect(shouldBlockEditorNavigation('conflict', current, next)).toBe(false)
  })

  it('still blocks route, hash, and unrelated query changes while work is unsaved', () => {
    expect(shouldBlockEditorNavigation('dirty', current, { ...current, pathname: '/projects' })).toBe(true)
    expect(shouldBlockEditorNavigation('dirty', current, { ...current, hash: '#share' })).toBe(true)
    expect(shouldBlockEditorNavigation('dirty', current, { ...current, search: '?panel=data&page=page-home' })).toBe(
      true,
    )
  })

  it('allows all navigation once the draft is saved', () => {
    expect(shouldBlockEditorNavigation('saved', current, { ...current, pathname: '/projects' })).toBe(false)
  })
})
