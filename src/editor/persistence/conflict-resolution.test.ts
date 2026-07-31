import { describe, expect, it } from 'vitest'

import { buildLocalDraftExport, getBlockedNavigationAction } from './conflict-resolution'

describe('draft conflict resolution', () => {
  it('routes a blocked conflict to explicit resolution instead of another save attempt', () => {
    expect(getBlockedNavigationAction('conflict')).toBe('resolve-conflict')
    expect(getBlockedNavigationAction('dirty')).toBe('flush')
    expect(getBlockedNavigationAction('error')).toBe('flush')
  })

  it('builds a readable local backup without mutating the schema', () => {
    const schema = { version: 1, componentsTree: [{ id: 'local-only' }] }
    const backup = buildLocalDraftExport(schema, '销售 / 大屏', new Date('2026-07-30T10:11:12.000Z'))

    expect(backup.filename).toBe('销售-大屏-local-draft-20260730-101112.json')
    expect(JSON.parse(backup.content)).toEqual(schema)
    expect(schema.componentsTree).toEqual([{ id: 'local-only' }])
  })
})
