import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

describe('outline sidebar DOM structure', () => {
  it('lets OutlineTree own exactly one list item at each tree level', async () => {
    const source = await readFile(path.join(currentDirectory, 'Outline.tsx'), 'utf8')
    const rootList = source.slice(source.indexOf('<SidebarMenu className'), source.indexOf('const OutlineTree'))

    expect(rootList).toContain('<OutlineTree key={index}')
    expect(rootList).not.toMatch(/<SidebarMenuItem[\s\S]*<OutlineTree/)
    expect(source).toMatch(/if \(!node\.childrenNodes\?\.length\) \{[\s\S]*return \(\s*<SidebarMenuItem>/)
  })
})
