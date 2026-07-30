import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

async function readSource(filePath: string): Promise<string> {
  return readFile(path.resolve(currentDirectory, filePath), 'utf8')
}

describe.each([
  ['method editor', 'MethodEditorModal.tsx', "className='flex flex-col gap-4 h-[600px] mt-2'"],
  ['state editor', 'StateEditorModal.tsx', "className='flex flex-col gap-4 h-[400px] mt-2'"],
])('%s DOM structure', (_, filePath, formClassName) => {
  it('keeps the editor form outside the paragraph-based dialog description', async () => {
    const source = await readSource(filePath)
    const description = source.slice(
      source.indexOf('<DialogDescription'),
      source.indexOf('</DialogDescription>') + '</DialogDescription>'.length,
    )

    expect(description).not.toContain('<div')
    expect(description).not.toContain('<Input')
    expect(description).not.toContain('<CodeEditor')
    const formStart = source.indexOf(`<div ${formClassName}>`)

    expect(formStart).toBeGreaterThan(source.indexOf('</DialogHeader>'))
    expect(formStart).toBeLessThan(source.indexOf('<DialogFooter>'))
  })
})
