import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

async function readSource(fileName: string): Promise<string> {
  return readFile(path.join(currentDirectory, fileName), 'utf8')
}

describe('preview navigation contract', () => {
  it('commits an internal page navigation only after its remote materials load', async () => {
    const source = await readSource('ProjectSchemaRenderer.tsx')
    const loadIndex = source.indexOf('await loadRemoteMaterialsFromComponentsMap(projectComponentsMap)')
    const notifyIndex = source.indexOf('if (nextPageId) onActivePageChange?.(nextPageId)')

    expect(loadIndex).toBeGreaterThan(-1)
    expect(source).toContain("const materialRenderKey = Object.keys(remoteComponents).sort().join('|')")
    expect(source).toContain("key={`${project.id}:${initialPage ?? 'empty'}:${materialRenderKey}`}")
    expect(source).toContain('await navigationRunner.run({')
    expect(source).toContain('useEffect(() => () => navigationRunner.invalidate(), [navigationRunner])')
    expect(source).toContain("setNavigationError(reason instanceof Error ? reason : new Error('页面物料加载失败'))")
    expect(notifyIndex).toBeGreaterThan(loadIndex)
  })

  it('keeps the URL, picker, and editor return target aligned with the rendered page', async () => {
    const source = await readSource('index.tsx')

    expect(source).toContain('editorPageId={currentRenderedPageId}')
    expect(source).toContain('activePageId={currentRenderedPageId}')
    expect(source).toMatch(/onActivePageChange=\{activePageId => \{[\s\S]*?selectPage\(activePageId\)/)
    expect(source).toContain("className='relative h-screen w-full overflow-hidden")
    expect(source).toContain("className='absolute left-4 top-4 z-50")
    expect(source).not.toMatch(/DRAFT UNAVAILABLE|PAGE NOT FOUND|INVALID ROUTE/)
  })
})
