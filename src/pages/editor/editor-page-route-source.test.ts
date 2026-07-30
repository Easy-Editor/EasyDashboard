import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

describe('editor page route runtime cost', () => {
  it('does not export or decode the entire project while observing page changes', async () => {
    const source = await readFile(path.join(currentDirectory, 'index.tsx'), 'utf8')

    expect(source).toContain('selectEditorRouteProjectState(componentsTree, projectMeta)')
    expect(source).not.toContain('project.export()')
    expect(source).not.toContain('decodeDashboardProjectDocument')
  })
})
