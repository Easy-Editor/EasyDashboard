import {
  type DashboardPageTheme,
  type DashboardProjectDocument,
  type DashboardTheme,
  type DashboardThemeMode,
  decodeDashboardProjectDocument,
  resolvePageTheme,
} from './project-document'

export const DASHBOARD_THEME_TOKEN = {
  background: '--dashboard-background',
  foreground: '--dashboard-foreground',
  accent: '--dashboard-accent',
} as const

export type DashboardThemePresetId = 'spectral' | 'deep-ocean' | 'blueprint'

export type DashboardThemePreset = {
  id: DashboardThemePresetId
  name: string
  description: string
  themes: Record<DashboardThemeMode, DashboardTheme>
}

export const DASHBOARD_THEME_PRESETS: readonly DashboardThemePreset[] = [
  {
    id: 'spectral',
    name: '光谱蓝',
    description: '蓝青光谱，适合数据密集型大屏',
    themes: {
      dark: {
        mode: 'dark',
        tokens: {
          [DASHBOARD_THEME_TOKEN.background]: '#080A0D',
          [DASHBOARD_THEME_TOKEN.foreground]: '#F1F5F7',
          [DASHBOARD_THEME_TOKEN.accent]: '#67C6D9',
        },
      },
      light: {
        mode: 'light',
        tokens: {
          [DASHBOARD_THEME_TOKEN.background]: '#F3F9FC',
          [DASHBOARD_THEME_TOKEN.foreground]: '#102630',
          [DASHBOARD_THEME_TOKEN.accent]: '#087EA4',
        },
      },
    },
  },
  {
    id: 'deep-ocean',
    name: '深海青',
    description: '低亮背景与清晰的青色信号',
    themes: {
      dark: {
        mode: 'dark',
        tokens: {
          [DASHBOARD_THEME_TOKEN.background]: '#06141B',
          [DASHBOARD_THEME_TOKEN.foreground]: '#E7F7FA',
          [DASHBOARD_THEME_TOKEN.accent]: '#22D3EE',
        },
      },
      light: {
        mode: 'light',
        tokens: {
          [DASHBOARD_THEME_TOKEN.background]: '#F2FBFC',
          [DASHBOARD_THEME_TOKEN.foreground]: '#12343B',
          [DASHBOARD_THEME_TOKEN.accent]: '#0891B2',
        },
      },
    },
  },
  {
    id: 'blueprint',
    name: '蓝图',
    description: '克制的工程蓝，强调结构与层级',
    themes: {
      dark: {
        mode: 'dark',
        tokens: {
          [DASHBOARD_THEME_TOKEN.background]: '#0A1020',
          [DASHBOARD_THEME_TOKEN.foreground]: '#EEF4FF',
          [DASHBOARD_THEME_TOKEN.accent]: '#60A5FA',
        },
      },
      light: {
        mode: 'light',
        tokens: {
          [DASHBOARD_THEME_TOKEN.background]: '#F5F8FF',
          [DASHBOARD_THEME_TOKEN.foreground]: '#172554',
          [DASHBOARD_THEME_TOKEN.accent]: '#2563EB',
        },
      },
    },
  },
] as const

function cloneTheme(theme: DashboardTheme): DashboardTheme {
  return {
    mode: theme.mode,
    tokens: { ...theme.tokens },
  }
}

function findPage(document: DashboardProjectDocument, pageId: string) {
  const page = document.editorSchema.componentsTree.find(page => page.meta.easyDashboard.pageId === pageId)
  if (!page) throw new Error(`Unknown dashboard page: ${pageId}`)
  return page
}

function matchingPreset(theme: DashboardTheme): DashboardThemePreset | undefined {
  return DASHBOARD_THEME_PRESETS.find(preset => {
    const candidate = preset.themes[theme.mode]
    return (
      candidate.tokens[DASHBOARD_THEME_TOKEN.background] === theme.tokens[DASHBOARD_THEME_TOKEN.background] &&
      candidate.tokens[DASHBOARD_THEME_TOKEN.accent] === theme.tokens[DASHBOARD_THEME_TOKEN.accent]
    )
  })
}

export function convertDashboardThemeMode(theme: DashboardTheme, mode: DashboardThemeMode): DashboardTheme {
  if (theme.mode === mode) return cloneTheme(theme)

  const matchingThemePreset = matchingPreset(theme)
  if (matchingThemePreset) return cloneTheme(matchingThemePreset.themes[mode])

  const modeFoundation = DASHBOARD_THEME_PRESETS[0].themes[mode]
  return {
    mode,
    tokens: {
      ...theme.tokens,
      [DASHBOARD_THEME_TOKEN.background]: modeFoundation.tokens[DASHBOARD_THEME_TOKEN.background],
      [DASHBOARD_THEME_TOKEN.foreground]: modeFoundation.tokens[DASHBOARD_THEME_TOKEN.foreground],
    },
  }
}

function writeProjectTheme(document: DashboardProjectDocument, theme: DashboardTheme): void {
  document.presentation.theme = cloneTheme(theme)
  const meta = document.editorSchema.meta ?? {}
  const easyDashboard =
    meta.easyDashboard && typeof meta.easyDashboard === 'object' ? (meta.easyDashboard as Record<string, unknown>) : {}

  document.editorSchema.meta = {
    ...meta,
    easyDashboard: {
      ...easyDashboard,
      theme: cloneTheme(theme),
    },
  }
}

export function setDashboardProjectTheme(
  document: DashboardProjectDocument,
  update: Partial<DashboardTheme> & { tokens?: Record<string, string> },
): DashboardProjectDocument {
  const next = decodeDashboardProjectDocument(document)
  writeProjectTheme(next, {
    mode: update.mode ?? next.presentation.theme.mode,
    tokens: {
      ...next.presentation.theme.tokens,
      ...update.tokens,
    },
  })
  return next
}

export function applyDashboardThemePreset(
  document: DashboardProjectDocument,
  presetId: DashboardThemePresetId,
  mode: DashboardThemeMode = document.presentation.theme.mode,
): DashboardProjectDocument {
  const preset = DASHBOARD_THEME_PRESETS.find(candidate => candidate.id === presetId)
  if (!preset) throw new Error(`Unknown dashboard theme preset: ${presetId}`)
  return setDashboardProjectTheme(document, preset.themes[mode])
}

export function setDashboardPageThemeInheritance(
  document: DashboardProjectDocument,
  pageId: string,
  inheritProjectTheme: boolean,
): DashboardProjectDocument {
  const next = decodeDashboardProjectDocument(document)
  const page = findPage(next, pageId)

  if (inheritProjectTheme) {
    page.meta.easyDashboard.theme = undefined
  } else if (!page.meta.easyDashboard.theme) {
    page.meta.easyDashboard.theme = cloneTheme(next.presentation.theme)
  }

  return next
}

export function setDashboardPageTheme(
  document: DashboardProjectDocument,
  pageId: string,
  update: DashboardPageTheme,
): DashboardProjectDocument {
  const next = decodeDashboardProjectDocument(document)
  const page = findPage(next, pageId)
  const effectiveTheme = resolvePageTheme(next, pageId)

  page.meta.easyDashboard.theme = {
    mode: update.mode ?? page.meta.easyDashboard.theme?.mode ?? effectiveTheme.mode,
    tokens: {
      ...effectiveTheme.tokens,
      ...page.meta.easyDashboard.theme?.tokens,
      ...update.tokens,
    },
  }

  return next
}

export function isDashboardPageThemeInherited(document: DashboardProjectDocument, pageId: string): boolean {
  return findPage(document, pageId).meta.easyDashboard.theme === undefined
}
