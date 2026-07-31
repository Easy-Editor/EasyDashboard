import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

async function readSource(fileName: string): Promise<string> {
  return readFile(path.join(currentDirectory, fileName), 'utf8')
}

describe('page sidebar DOM structure', () => {
  it('uses one menu item per list level', async () => {
    const source = await readSource('index.tsx')
    const sidebarMarkup = source.slice(source.indexOf('return ('), source.indexOf('const Page:'))

    expect(sidebarMarkup).not.toMatch(/<SidebarMenuItem[^>]*>\s*<SidebarMenuItem/)
    expect(source).toContain('<SidebarMenuSubItem')
    expect(source).toContain('</SidebarMenuSubItem>')
  })

  it('keeps form layout outside the paragraph-based dialog description', async () => {
    const source = await readSource('PageModal.tsx')
    const description = source.slice(
      source.indexOf('<DialogDescription'),
      source.indexOf('</DialogDescription>') + '</DialogDescription>'.length,
    )

    expect(description).not.toContain('<div')
    expect(source).toMatch(/<\/DialogDescription>\s*<div className='mt-2 flex flex-col gap-4'>/)
  })

  it('exposes page actions as named buttons', async () => {
    const source = await readSource('index.tsx')

    expect(source).toContain("aria-label='新增页面'")
    expect(source).toContain("aria-label='展开或收起页面列表'")
    expect(source).toContain('aria-label={`打开页面：${page.fileDesc}`}')
    expect(source).toContain('aria-label={`编辑页面：${page.fileDesc}`}')
    expect(source).toContain('aria-label={`删除页面：${page.fileDesc}`}')
  })

  it('uses a native button for the primary page selection action without nesting row actions', async () => {
    const source = await readSource('index.tsx')
    const pageRow = source.slice(source.indexOf('const isCurrentPage'), source.indexOf('</SidebarMenuSubItem>'))
    const primaryAction = pageRow.slice(pageRow.indexOf('<button'), pageRow.indexOf('<SidebarMenuExtra>'))

    expect(primaryAction).toContain("type='button'")
    expect(primaryAction).toContain('aria-label={`打开页面：${page.fileDesc}`}')
    expect(primaryAction).toContain('onClick={() => void handleSelect(page)}')
    expect(primaryAction).not.toContain('<SidebarMenuExtra>')
    expect(pageRow).not.toMatch(/<div[^>]*onClick=\{\(\) => handleSelect\(page\)\}/)
  })

  it('keeps the page name readable while moving its route identifier to a compact second line', async () => {
    const source = await readSource('index.tsx')

    expect(source).toContain('{page.fileDesc}</span>')
    expect(source).toContain("PAGE {String(pageIndex + 1).padStart(2, '0')} · {page.fileName}")
    expect(source).not.toContain('({page.fileName})')
  })

  it('keeps page form inputs controlled for the full dialog lifecycle', async () => {
    const source = await readSource('PageModal.tsx')

    expect(source).toContain("useState(data?.fileName ?? '')")
    expect(source).toContain("useState(data?.fileDesc ?? '')")
    expect(source).toContain("setFileName(data?.fileName ?? '')")
    expect(source).toContain("setFileDesc(data?.fileDesc ?? '')")
  })
})
