import { describe, expect, it } from 'vitest'
import { formatRevisionKind, formatRevisionTime } from './version-format'

describe('version record formatting', () => {
  it('keeps persisted revision kinds distinct in the UI', () => {
    expect(formatRevisionKind('manual')).toBe('手动备份')
    expect(formatRevisionKind('auto')).toBe('自动保存')
    expect(formatRevisionKind('pre_restore')).toBe('恢复前备份')
    expect(formatRevisionKind('publish')).toBe('发布版本')
  })

  it('formats valid server times and handles invalid timestamps', () => {
    expect(formatRevisionTime('2026-07-30T06:08:00.000Z', () => '07/30 14:08')).toBe('07/30 14:08')
    expect(formatRevisionTime('invalid')).toBe('时间未知')
  })
})
