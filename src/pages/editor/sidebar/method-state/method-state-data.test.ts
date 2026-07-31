import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeExtraPropRecord } from './utils'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

describe('method and state sidebar data defaults', () => {
  it.each([undefined, null])('normalizes %s to an empty record', value => {
    expect(normalizeExtraPropRecord(value)).toEqual({})
  })

  it('returns an existing record without changing its identity', () => {
    const record = { save: { type: 'JSFunction' } }

    expect(normalizeExtraPropRecord(record)).toBe(record)
  })

  it('uses the normalizer at every list boundary', async () => {
    const sources = await Promise.all(
      ['LifeCycleList.tsx', 'MethodList.tsx', 'StateList.tsx'].map(fileName =>
        readFile(path.join(currentDirectory, fileName), 'utf8'),
      ),
    )

    for (const source of sources) {
      expect(source).toContain('normalizeExtraPropRecord(')
    }
  })

  it('keeps an add action visible for empty collections', async () => {
    const sources = await Promise.all(
      ['LifeCycleList.tsx', 'MethodList.tsx', 'StateList.tsx'].map(fileName =>
        readFile(path.join(currentDirectory, fileName), 'utf8'),
      ),
    )

    expect(sources[0]).toContain("aria-label='新增生命周期方法'")
    expect(sources[0]).toContain('<DropdownMenuTrigger asChild>')
    expect(sources[0]).toContain("type='button'")
    expect(sources[0]).toContain('onSelect={() => handleAdd(option.name)}')
    expect(sources[1]).toContain("aria-label='新增普通方法'")
    expect(sources[2]).toContain("aria-label='新增状态'")
    expect(sources[0]).toContain('暂无生命周期方法，点击 + 新增。')
    expect(sources[1]).toContain('暂无普通方法，点击 + 新增。')
    expect(sources[2]).toContain('暂无状态，点击 + 新增。')
    for (const source of sources) {
      expect(source).toContain('setOpen(true)')
    }
  })
})
