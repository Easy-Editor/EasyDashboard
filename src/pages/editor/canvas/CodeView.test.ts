import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

describe('code view product copy', () => {
  it('uses a clear Chinese feature name', async () => {
    const source = await readFile(path.join(currentDirectory, 'CodeView.tsx'), 'utf8')

    expect(source).toContain('页面结构代码')
    expect(source).not.toContain('Schema Editor')
  })
})
