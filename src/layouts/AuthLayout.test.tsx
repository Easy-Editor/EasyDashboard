import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AuthLayout } from './AuthLayout'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

describe('AuthLayout visual contract', () => {
  it('renders a personal creator entry with a pseudo-3d big-screen canvas', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AuthLayout />
      </MemoryRouter>,
    )

    expect(html).toContain('让每一块大屏，')
    expect(html).toContain('都有自己的样子。')
    expect(html).toContain('从页面、数据到交互效果，边搭建边预览，随时发布你的作品。')
    expect(html).toContain('我的运营大屏')
    expect(html).toContain('ed-auth-editor-preview')
    expect(html).toContain('ed-auth-editor-ruler-x')
    expect(html).toContain('ed-auth-editor-selected')
    expect(html).toContain('趋势组件')
    expect(html).not.toContain('auth-dashboard-canvas.jpg')
    expect(html).toContain('拟 3D 大屏创作画布')
    expect(html).toContain('ed-auth-page-layer-back')
    expect(html).toContain('ed-auth-device-frame')
    expect(html).not.toContain('data-auth-core')
    expect(html).not.toContain('近 7 日访问')
    expect(html).not.toContain('Agent 负责搭建')
  })

  it('uses one restrained desktop-only surface system', async () => {
    const styles = await readFile(path.join(currentDirectory, '..', 'styles', 'global.css'), 'utf8')

    expect(styles).toContain('.ed-auth-device')
    expect(styles).toContain('perspective: 1050px')
    expect(styles).toContain('bottom: clamp(24px, 4vh, 54px)')
    expect(styles).toContain('rotateY(12deg)')
    expect(styles).toContain('.ed-auth-device-frame::before')
    expect(styles).toContain('left: -28px')
    expect(styles).toContain('transform: rotateY(-72deg)')
    expect(styles).toContain('.ed-auth-showcase::after')
    expect(styles).toContain('.ed-auth-editor-selected')
    expect(styles).toContain('border: 1px solid var(--ed-blue)')
    expect(styles).toContain('.ed-auth-editor-rail svg.is-active')
    expect(styles).toContain('background: #070b11')
    expect(styles).toContain('min-width: 1180px')
    expect(styles).toContain('min-height: max(720px, 100dvh)')
    expect(styles).toContain('@media (max-height: 820px) and (min-width: 1180px)')
    expect(styles).toContain('bottom: 12px')
    expect(styles).not.toContain('@media (max-width: 767px)')
    expect(styles).not.toContain('.ed-auth-mobile-brand')
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })

  it('keeps the login primary action high contrast without a glow treatment', async () => {
    const source = await readFile(path.join(currentDirectory, '..', 'pages', 'auth', 'LoginPage.tsx'), 'utf8')

    expect(source).toContain('bg-[#c9e5eb]')
    expect(source).toContain('text-[#071015]')
    expect(source).toContain('shadow-none')
    expect(source).not.toContain('shadow-[0_0_')
  })
})
