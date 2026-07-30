import { describe, expect, it } from 'vitest'

import { formatEditorSaveStatus } from './save-status'

describe('formatEditorSaveStatus', () => {
  const formatTime = () => '14:08'

  it('shows the server-confirmed save time for clean drafts', () => {
    expect(formatEditorSaveStatus({ status: 'saved', savedAt: '2026-07-30T06:08:00.000Z' }, formatTime)).toBe(
      '已保存 · 14:08',
    )
  })

  it('keeps transient and failure states explicit', () => {
    expect(formatEditorSaveStatus({ status: 'dirty', savedAt: null }, formatTime)).toBe('有未保存更改')
    expect(formatEditorSaveStatus({ status: 'saving', savedAt: null }, formatTime)).toBe('保存中…')
    expect(formatEditorSaveStatus({ status: 'conflict', savedAt: null }, formatTime)).toBe('版本冲突')
  })
})
