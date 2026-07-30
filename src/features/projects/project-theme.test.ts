import { describe, expect, it } from 'vitest'
import { decodeDashboardProjectDocument, resolvePageTheme } from './project-document'
import {
  DASHBOARD_THEME_PRESETS,
  DASHBOARD_THEME_TOKEN,
  applyDashboardThemePreset,
  convertDashboardThemeMode,
  isDashboardPageThemeInherited,
  setDashboardPageTheme,
  setDashboardPageThemeInheritance,
  setDashboardProjectTheme,
} from './project-theme'

function createDocument() {
  return decodeDashboardProjectDocument({
    version: '1.0.0',
    componentsTree: [
      {
        componentName: 'Root',
        fileName: 'overview',
        meta: { easyDashboard: { pageId: 'page-overview' } },
      },
      {
        componentName: 'Root',
        fileName: 'details',
        meta: {
          easyDashboard: {
            pageId: 'page-details',
            theme: {
              mode: 'light',
              tokens: { [DASHBOARD_THEME_TOKEN.accent]: '#FF6600' },
            },
          },
        },
      },
    ],
  })
}

describe('dashboard project theme mutations', () => {
  it('updates canonical project metadata without mutating the source document', () => {
    const source = createDocument()
    const next = setDashboardProjectTheme(source, {
      mode: 'light',
      tokens: { [DASHBOARD_THEME_TOKEN.accent]: '#087EA4' },
    })

    expect(source.presentation.theme.mode).toBe('dark')
    expect(next.presentation.theme).toEqual(next.editorSchema.meta?.easyDashboard?.theme)
    expect(next.presentation.theme).toMatchObject({
      mode: 'light',
      tokens: { [DASHBOARD_THEME_TOKEN.accent]: '#087EA4' },
    })
  })

  it('applies the selected preset in the active light or dark mode', () => {
    const next = applyDashboardThemePreset(createDocument(), 'spectral', 'light')
    const spectralLight = DASHBOARD_THEME_PRESETS[0].themes.light

    expect(next.presentation.theme).toEqual(spectralLight)
    expect(next.editorSchema.meta?.easyDashboard?.theme).toEqual(spectralLight)
  })

  it('switches preset foundations with mode and preserves a custom accent', () => {
    const projectTheme = createDocument().presentation.theme
    const spectralLight = convertDashboardThemeMode(projectTheme, 'light')
    const customizedLight = convertDashboardThemeMode(
      {
        ...projectTheme,
        tokens: { ...projectTheme.tokens, [DASHBOARD_THEME_TOKEN.accent]: '#0EA5E9' },
      },
      'light',
    )

    expect(spectralLight).toEqual(DASHBOARD_THEME_PRESETS[0].themes.light)
    expect(customizedLight).toMatchObject({
      mode: 'light',
      tokens: {
        [DASHBOARD_THEME_TOKEN.background]:
          DASHBOARD_THEME_PRESETS[0].themes.light.tokens[DASHBOARD_THEME_TOKEN.background],
        [DASHBOARD_THEME_TOKEN.accent]: '#0EA5E9',
      },
    })
  })
})

describe('dashboard page theme inheritance', () => {
  it('inherits project changes while no page override exists', () => {
    const source = createDocument()
    const recolored = setDashboardProjectTheme(source, {
      tokens: { [DASHBOARD_THEME_TOKEN.background]: '#102030' },
    })

    expect(isDashboardPageThemeInherited(recolored, 'page-overview')).toBe(true)
    expect(resolvePageTheme(recolored, 'page-overview').tokens[DASHBOARD_THEME_TOKEN.background]).toBe('#102030')
  })

  it('creates an explicit page snapshot and can return to project inheritance', () => {
    const source = createDocument()
    const overridden = setDashboardPageThemeInheritance(source, 'page-overview', false)
    const recolored = setDashboardPageTheme(overridden, 'page-overview', {
      mode: 'light',
      tokens: { [DASHBOARD_THEME_TOKEN.accent]: '#0EA5E9' },
    })

    expect(isDashboardPageThemeInherited(recolored, 'page-overview')).toBe(false)
    expect(resolvePageTheme(recolored, 'page-overview')).toMatchObject({
      mode: 'light',
      tokens: { [DASHBOARD_THEME_TOKEN.accent]: '#0EA5E9' },
    })
    expect(
      recolored.editorSchema.componentsTree[1].meta.easyDashboard.theme?.tokens?.[DASHBOARD_THEME_TOKEN.accent],
    ).toBe('#FF6600')

    const inherited = setDashboardPageThemeInheritance(recolored, 'page-overview', true)
    expect(isDashboardPageThemeInherited(inherited, 'page-overview')).toBe(true)
    expect(resolvePageTheme(inherited, 'page-overview')).toEqual(inherited.presentation.theme)
  })
})
