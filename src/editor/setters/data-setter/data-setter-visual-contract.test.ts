import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

async function readSource(fileName: string): Promise<string> {
  return readFile(path.join(currentDirectory, fileName), 'utf8')
}

async function readStylesheet(): Promise<string> {
  return readFile(path.join(currentDirectory, '../../../styles/global.css'), 'utf8')
}

describe('data setter visual contract', () => {
  it('keeps the compact table editor inside the Phase 0 inspector theme', async () => {
    const tableSource = await readSource('DataTableView.tsx')
    const setterSource = await readSource('index.tsx')
    const stylesheet = await readStylesheet()

    expect(tableSource).toContain("className='ed-data-grid")
    expect(tableSource).toContain('headerRowHeight={28}')
    expect(tableSource).toContain('rowHeight={30}')
    expect(tableSource).toContain('const gridHeight = 28 + Math.min(rows.length, 6) * 30')
    expect(tableSource).toContain("width: 'minmax(112px, 1fr)'")
    expect(tableSource).toMatch(/width: 32,\s+minWidth: 32,\s+maxWidth: 32,/)

    expect(setterSource).toContain("role='tablist'")
    expect(setterSource).toContain("role='tab'")
    expect(setterSource).toContain("aria-selected={previewView === 'table'}")
    expect(setterSource).toContain("aria-controls='data-view-panel-table'")
    expect(setterSource).toContain("tabIndex={previewView === 'table' ? 0 : -1}")
    expect(setterSource).toContain("role='tabpanel'")
    expect(setterSource).toContain('handlePreviewViewKeyDown')
    expect(setterSource).not.toContain('shadow-sm')

    expect(stylesheet).toContain('[data-editor-configure] .ed-data-grid {')
    expect(stylesheet).toContain('--rdg-background-color: var(--ed-panel);')
    expect(stylesheet).toContain('--rdg-header-background-color: var(--ed-panel-raised);')
    expect(stylesheet).toContain('--rdg-border-color: var(--ed-line);')
    expect(stylesheet).toContain('--rdg-selection-color: var(--ed-blue);')
    expect(stylesheet).toContain('--rdg-checkbox-focus-color: var(--ed-cyan);')
    expect(stylesheet).toContain('[data-editor-configure] .ed-data-grid-editor')
  })
})
