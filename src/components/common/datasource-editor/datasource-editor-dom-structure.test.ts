import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

async function readSource(filePath: string): Promise<string> {
  return readFile(path.resolve(currentDirectory, filePath), 'utf8')
}

describe('data source editor DOM structure', () => {
  it('keeps form sections outside the paragraph-based dialog description', async () => {
    const source = await readSource('index.tsx')
    const description = source.slice(
      source.indexOf('<DialogDescription'),
      source.indexOf('</DialogDescription>') + '</DialogDescription>'.length,
    )

    expect(description).not.toContain('<BasicInfoSection')
    expect(description).not.toContain('<RequestConfigSection')
    expect(description).not.toContain('<FunctionConfigSection')
    expect(source).toMatch(/<\/DialogHeader>\s*<div className='mt-2 flex flex-col gap-4'>/)
  })

  it('exposes the add-data-source action as a named native button', async () => {
    const source = await readSource('../../../pages/editor/sidebar/data-source/DataSourceList.tsx')
    const addAction = source.slice(source.indexOf('<button'), source.indexOf('</button>') + '</button>'.length)

    expect(addAction).toContain("type='button'")
    expect(addAction).toContain("aria-label='新增数据源'")
    expect(addAction).toContain('onClick={handleAdd}')
    expect(addAction).toContain("aria-hidden='true'")
    expect(addAction).not.toMatch(/<Plus[^>]*onClick=/)
  })
})
