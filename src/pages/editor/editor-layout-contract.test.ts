import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

async function readSource(fileName: string): Promise<string> {
  return readFile(path.join(currentDirectory, fileName), 'utf8')
}

async function readProjectSource(relativePath: string): Promise<string> {
  return readFile(path.join(currentDirectory, '../../..', relativePath), 'utf8')
}

describe('editor panel layout contracts', () => {
  it('keeps the compact tool rail icon-only without losing accessible names', async () => {
    const source = await readSource('sidebar/index.tsx')

    expect(source).toContain('data-editor-tool-rail')
    expect(source).toContain('aria-label={item.title}')
    expect(source).toContain("aria-controls='editor-tool-panel'")
    expect(source).toContain('aria-expanded={activeItem?.key === item.key && open}')
    expect(source).toContain('aria-pressed={activeItem?.key === item.key}')
    expect(source).toContain("id='editor-tool-panel'")
    expect(source).toContain("<span className='sr-only'>{item.title}</span>")
    expect(source).not.toContain('<span>{item.title}</span>')
  })

  it('allows property setters to shrink inside the fixed configuration panel', async () => {
    const configureSource = await readSource('configure/index.tsx')
    const fieldSource = await readSource('../../editor/setters/CustomFieldItem.tsx')

    expect(configureSource).toContain('data-editor-configure')
    expect(configureSource).toContain(
      "className='min-w-0 bg-[var(--ed-panel)] p-3 text-[var(--ed-ink)] [&>*]:max-w-full'",
    )
    expect(configureSource).not.toContain('overflow-x-hidden')
    expect(fieldSource).toMatch(/flex w-full min-w-0 items-center/)
    expect(fieldSource).toMatch(/flex w-full min-w-0 max-w-full text-xs/)
    expect(fieldSource).toMatch(/flex min-w-0 w-full flex-1 items-center justify-between/)
    expect(fieldSource).toMatch(/min-w-0 max-w-full flex-1/)
  })

  it('uses one Phase 0 surface hierarchy across rails, panels, and the canvas world', async () => {
    const layoutSource = await readSource('EditorLayout.tsx')
    const sidebarSource = await readSource('sidebar/index.tsx')
    const configureSource = await readSource('configure/index.tsx')
    const historySource = await readSource('header/HistoryButtons.tsx')
    const headerSource = await readSource('header/index.tsx')
    const modeTabsSource = await readSource('header/EditorModeTabs.tsx')
    const navSource = await readSource('header/Nav.tsx')
    const publishDialogSource = await readSource('header/PublishShareDialog.tsx')
    const toolbarSource = await readProjectSource('src/components/editor/canvas-toolbar/index.tsx')
    const rulerSource = await readProjectSource('src/components/editor/ruler/RulerWrapper.tsx')
    const stylesheet = await readProjectSource('src/styles/global.css')
    const overrides = await readProjectSource('src/editor/overrides.css')
    const outlineStyles = await readSource('sidebar/Outline.module.css')
    const colorSetterSource = await readProjectSource('src/editor/setters/color-setter/index.tsx')
    const alertModalSource = await readProjectSource('src/components/common/AlertModal.tsx')

    expect(layoutSource).toContain("data-ed-shell='editor'")
    expect(layoutSource).toContain('bg-[var(--ed-canvas)] text-[var(--ed-ink)]')
    expect(layoutSource).toContain("'--sidebar-width': 'calc(var(--ed-tool-rail-width) + var(--ed-left-panel-width))'")
    expect(layoutSource).toContain("width: 'var(--ed-inspector-width)'")
    expect(layoutSource).toContain('gap-0')
    expect(sidebarSource).toContain('bg-[var(--ed-rail)]')
    expect(sidebarSource).toContain('bg-[var(--ed-panel)]')
    expect(sidebarSource).toContain('useState(data.navTop[0])')
    expect(sidebarSource).toContain('h-[var(--ed-panel-header-height)]')
    expect(configureSource).toContain('bg-[var(--ed-panel)]')
    expect(configureSource).toContain('h-[var(--ed-panel-header-height)]')
    expect(configureSource).toContain('bg-[var(--ed-cyan)]')
    expect(configureSource).not.toContain('bg-orange-100')
    expect(configureSource).not.toContain('bg-gray-100')
    expect(configureSource).toContain("portal.dataset.edShell = 'editor'")
    expect(headerSource).toContain('h-[var(--ed-header-height)]')
    expect(headerSource).toContain('bg-[var(--ed-rail)]/95')
    expect(historySource).toContain('size-[var(--ed-control-compact)]')
    expect(historySource).toContain("className='size-4'")
    expect(modeTabsSource).toContain('bg-[var(--ed-canvas)]')
    expect(navSource).toContain('text-[var(--ed-ink-soft)]')
    expect(navSource).toContain('currentPageName')
    expect(publishDialogSource).toContain("data-ed-shell='editor'")
    expect(publishDialogSource).toContain('bg-[var(--ed-panel)]')
    expect(publishDialogSource).toContain('border-[var(--ed-line)]')
    expect(toolbarSource).toContain('bg-[var(--ed-panel)]/95')
    expect(toolbarSource).toContain("data-ed-shell='editor'")
    expect(rulerSource).toContain('style={canvasWorldStyle}')
    expect(rulerSource).toContain("'--scale': scale")

    expect(stylesheet).toContain('[data-editor-workbench],\n[data-ed-shell="editor"] {')
    expect(stylesheet).toMatch(
      /\[data-ed-shell="editor"\][\s\S]*?--popover: var\(--ed-panel\);[\s\S]*?--muted: var\(--ed-panel-raised\);/,
    )
    expect(stylesheet).toContain('--ruler-canvas-bg: var(--ed-canvas);')
    expect(stylesheet).toContain('--ruler-bg: var(--ed-rail);')
    expect(stylesheet).toContain('--sidebar: var(--ed-panel);')
    expect(stylesheet).toContain('--muted: var(--ed-panel-raised);')
    expect(stylesheet).toContain('--ring: var(--ed-cyan);')
    expect(stylesheet).toContain('--ed-header-height: 48px;')
    expect(stylesheet).toContain('--ed-tool-rail-width: 44px;')
    expect(stylesheet).toContain('--ed-left-panel-width: 264px;')
    expect(stylesheet).toContain('--ed-inspector-width: 304px;')
    expect(stylesheet).toContain('[data-editor-configure] [role="tablist"]')
    expect(stylesheet).toContain('[data-editor-configure] [class*="styles-module-header-"]')
    expect(stylesheet).toContain('background: var(--ed-panel-raised) !important;')
    expect(stylesheet).toContain('[data-ed-shell="editor"][data-slot="popover-content"]')
    expect(stylesheet).toContain('[data-ed-shell="editor"][data-slot="dialog-content"]')

    expect(overrides).toContain('--color-brand: var(--ed-blue);')
    expect(overrides).toContain('--color-canvas-guide: var(--ed-cyan);')
    expect(overrides).toContain('.lc-simulator .lc-simulator-canvas-viewport')
    expect(overrides).toContain('calc(1px / var(--scale, 1)) var(--ed-line-strong)')
    expect(outlineStyles).not.toContain('hsl(var(')
    expect(colorSetterSource).toContain("data-ed-shell='editor'")
    expect(alertModalSource).toContain("data-ed-shell={editorScoped ? 'editor' : undefined}")
  })
})
