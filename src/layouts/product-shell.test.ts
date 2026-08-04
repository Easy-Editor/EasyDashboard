import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const sourceRoot = path.resolve(currentDirectory, '..')

async function readSource(relativePath: string): Promise<string> {
  return readFile(path.join(sourceRoot, relativePath), 'utf8')
}

describe('product shell source contracts', () => {
  it('keeps the desktop navigation focused on the four product destinations', async () => {
    const shell = await readSource('layouts/WorkspaceRail.tsx')

    expect(shell).toContain("{ label: '首页', to: '/',")
    expect(shell).toContain("{ label: '所有项目', to: '/projects',")
    expect(shell).toContain("{ label: '回收站', to: '/trash',")
    expect(shell).toContain("{ label: '设置', to: '/settings',")
    expect(shell).not.toMatch(/模板|Agent|团队|数据源|3D/)
  })

  it('uses a hidden default rail, then lets people temporarily open or pin it', async () => {
    const [shell, rail] = await Promise.all([
      readSource('layouts/AppShell.tsx'),
      readSource('layouts/WorkspaceRail.tsx'),
    ])

    expect(rail).toContain("type WorkspaceRailMode = 'docked' | 'hidden' | 'overlay'")
    expect(shell).toContain("railMode === 'docked' ? 'pl-[216px]' : 'pl-0'")
    expect(shell).toContain('onPreferenceChange={persistRailPreference}')
    expect(shell).toContain('subscribeWorkspaceRailPreference')
    expect(shell).toContain('workspaceRailPreference: preference')
    expect(rail).toContain("readCachedWorkspaceRailPreference(ownerUserId) === 'collapsed' ? 'hidden' : 'docked'")
    expect(rail).toContain('onMouseEnter={openOverlay}')
    expect(rail).toContain("mode === 'hidden'")
    expect(rail).toContain("mode === 'overlay'")
    expect(rail).toContain('data-workspace-rail={mode}')
    expect(rail).toContain("className='fixed left-4 top-4")
    expect(rail).not.toContain("'w-14'")
    expect(rail).not.toContain('pl-14')
  })

  it('keeps the workspace drawer keyboard and focus controls accessible', async () => {
    const [rail, shell] = await Promise.all([
      readSource('layouts/WorkspaceRail.tsx'),
      readSource('layouts/AppShell.tsx'),
    ])

    expect(rail).toContain("aria-controls='workspace-navigation-panel'")
    expect(rail).toContain('aria-expanded={false}')
    expect(rail).toContain('aria-expanded={true}')
    expect(rail).toContain("event.key.toLowerCase() === 'b'")
    expect(rail).toContain("event.key !== 'Escape'")
    expect(rail).toContain('focusOnNextFrame(closeButtonRef)')
    expect(rail).toContain('focusOnNextFrame(expandButtonRef)')
    expect(rail).toContain('keepOverlayFocus')
    expect(shell).toContain("inert={railMode === 'overlay'}")
    expect(rail).toContain("persistPreference('collapsed')")
    expect(rail).toContain("persistPreference('docked')")
    expect(rail).toContain('固定侧边栏')
    expect(rail).toContain("role='alert'")
    expect(rail).toContain("aria-live='assertive'")
    expect(rail).toContain("mode === 'hidden' ? null : (")
    expect(rail.indexOf("role='alert'")).toBeLessThan(rail.indexOf("mode === 'hidden' ? null : ("))
    expect(rail).not.toContain("persistPreference('overlay')")
    expect(rail).toContain('border border-[var(--ed-line-strong)] bg-[var(--ed-panel)]')
    expect(rail).not.toContain('bg-[#e7f1f8]')
  })

  it('uses the real logo asset and scopes Precision Canvas tokens to the product shell', async () => {
    const [brand, stylesheet] = await Promise.all([
      readSource('components/brand/BrandMark.tsx'),
      readSource('styles/global.css'),
    ])

    expect(brand).toContain("import logoUrl from '@/assets/logo.svg'")
    expect(brand).toContain('src={logoUrl}')
    expect(brand).not.toContain('rounded-full')
    expect(stylesheet).toContain('[data-ed-shell] {')
    expect(stylesheet).toContain('--ed-canvas: #070a0f')
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)')
    expect(stylesheet).toContain('.ed-home-page::after')
    expect(stylesheet).toContain('@keyframes ed-home-reveal')
  })

  it('lets page titles carry hierarchy without English eyebrow labels', async () => {
    const frame = await readSource('layouts/PageFrame.tsx')

    expect(frame).not.toContain('eyebrow:')
    expect(frame).not.toContain('{eyebrow}')
    expect(frame).not.toContain('uppercase tracking')
    expect(frame).toContain('<h1')
  })

  it('keeps project cards compact and exposes both project browsing preferences', async () => {
    const projectsPage = await readSource('pages/projects/ProjectsPage.tsx')

    expect(projectsPage).toContain('grid-cols-[repeat(auto-fill,minmax(250px,1fr))]')
    expect(projectsPage).toContain("type ProjectView = 'grid' | 'list'")
    expect(projectsPage).toContain('easy-dashboard-project-view')
    expect(projectsPage).not.toMatch(/listTemplates|模板/)
  })
})
