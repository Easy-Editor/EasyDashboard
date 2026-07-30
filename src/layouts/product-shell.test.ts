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
    const shell = await readSource('layouts/AppShell.tsx')

    expect(shell).toContain("{ label: '首页', to: '/',")
    expect(shell).toContain("{ label: '所有项目', to: '/projects',")
    expect(shell).toContain("{ label: '回收站', to: '/trash',")
    expect(shell).toContain("{ label: '设置', to: '/settings',")
    expect(shell).not.toMatch(/模板|Agent|团队|数据源|3D/)
  })

  it('uses the real logo asset and scopes Precision Canvas tokens to the product shell', async () => {
    const [brand, stylesheet] = await Promise.all([
      readSource('components/brand/BrandMark.tsx'),
      readSource('styles/global.css'),
    ])

    expect(brand).toContain("import logoUrl from '@/assets/logo.svg'")
    expect(brand).toContain('src={logoUrl}')
    expect(stylesheet).toContain('[data-ed-shell] {')
    expect(stylesheet).toContain('--ed-canvas: #070a0f')
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('keeps project cards compact and exposes both project browsing preferences', async () => {
    const projectsPage = await readSource('pages/projects/ProjectsPage.tsx')

    expect(projectsPage).toContain('grid-cols-[repeat(auto-fill,minmax(260px,304px))]')
    expect(projectsPage).toContain("type ProjectView = 'grid' | 'list'")
    expect(projectsPage).toContain('easy-dashboard-project-view')
    expect(projectsPage).not.toMatch(/listTemplates|模板/)
  })
})
