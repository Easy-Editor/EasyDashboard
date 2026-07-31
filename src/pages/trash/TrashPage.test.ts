import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { isPermanentDeleteConfirmationValid } from './TrashPage'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

describe('TrashPage permanent deletion', () => {
  it('requires the exact project name before enabling permanent deletion', () => {
    expect(isPermanentDeleteConfirmationValid('城市运营大屏', '城市运营大屏')).toBe(true)
    expect(isPermanentDeleteConfirmationValid('城市运营大屏', ' 城市运营大屏 ')).toBe(false)
    expect(isPermanentDeleteConfirmationValid('城市运营大屏', '城市运营')).toBe(false)
  })

  it('keeps the destructive scope and failure behavior explicit', async () => {
    const source = await readFile(path.join(currentDirectory, 'TrashPage.tsx'), 'utf8')
    const permanentDeleteHandler = source.slice(
      source.indexOf('async function handlePermanentDelete'),
      source.indexOf('\n\n  return ('),
    )

    expect(source).toContain('所有页面、保存记录、发布版本、公开链接和缩略图都将永久删除')
    expect(source).toContain('项目仍保留在回收站中')
    expect(permanentDeleteHandler.indexOf('await deleteProjectPermanently(deleteTarget.id)')).toBeLessThan(
      permanentDeleteHandler.indexOf('setProjects(current => current?.filter'),
    )
  })

  it('renders loading failures independently from the empty-trash state', async () => {
    const source = await readFile(path.join(currentDirectory, 'TrashPage.tsx'), 'utf8')

    expect(source).toContain('{loadError ? (')
    expect(source).toContain("role='alert'")
    expect(source.indexOf('{loadError ? (')).toBeLessThan(source.indexOf(': projects === null ? ('))
  })
})
