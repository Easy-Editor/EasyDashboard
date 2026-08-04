import { getViewportFromSchema } from '@/editor/persistence/schema-viewport'
import {
  type DashboardProjectDocument,
  decodeDashboardProjectDocument,
  resolvePageFileName,
  resolveStartPageFileName,
} from '@/features/projects/project-document'
import type { ProjectSchema } from '@easy-editor/core'
import type { CSSProperties } from 'react'

type ProjectRootStyle = CSSProperties & Record<`--${string}`, string>

export function createDashboardPreviewAriaLabel(projectName: string): string {
  return `${projectName} 预览`
}

const semanticThemeTokens = {
  light: {
    '--background': '#ffffff',
    '--foreground': '#111827',
    '--card': '#ffffff',
    '--card-foreground': '#111827',
    '--popover': '#ffffff',
    '--popover-foreground': '#111827',
    '--primary': '#111827',
    '--primary-foreground': '#ffffff',
    '--secondary': '#f3f4f6',
    '--secondary-foreground': '#111827',
    '--muted': '#f3f4f6',
    '--muted-foreground': '#6b7280',
    '--accent': '#f3f4f6',
    '--accent-foreground': '#111827',
    '--border': '#e5e7eb',
    '--input': '#e5e7eb',
    '--ring': '#111827',
    '--dashboard-default-bg': '#e5e5e5',
  },
  dark: {
    '--background': '#000000',
    '--foreground': '#ffffff',
    '--card': '#111111',
    '--card-foreground': '#ffffff',
    '--popover': '#111111',
    '--popover-foreground': '#ffffff',
    '--primary': '#ffffff',
    '--primary-foreground': '#000000',
    '--secondary': '#1f2937',
    '--secondary-foreground': '#ffffff',
    '--muted': '#1f2937',
    '--muted-foreground': '#9ca3af',
    '--accent': '#1f2937',
    '--accent-foreground': '#ffffff',
    '--border': '#374151',
    '--input': '#374151',
    '--ring': '#ffffff',
    '--dashboard-default-bg': '#0A1017',
  },
} as const

function safeThemeTokens(tokens: Record<string, string>): Record<`--${string}`, string> {
  return Object.fromEntries(
    Object.entries(tokens).filter(
      (entry): entry is [`--${string}`, string] => /^--[a-z0-9_-]+$/i.test(entry[0]) && entry[1].trim().length > 0,
    ),
  )
}

function resolvePage(
  document: DashboardProjectDocument,
  requestedPageId?: string | null,
  activePageFileName?: string | null,
) {
  const requestedFileName = requestedPageId ? resolvePageFileName(document, requestedPageId) : undefined
  const initialPage = requestedFileName ?? resolveStartPageFileName(document)
  const activePage =
    (activePageFileName
      ? document.editorSchema.componentsTree.find(page => page.fileName === activePageFileName)
      : undefined) ?? document.editorSchema.componentsTree.find(page => page.fileName === initialPage)

  return {
    initialPage,
    page: activePage,
  }
}

export function createDashboardRenderModel(
  input: unknown,
  requestedPageId?: string | null,
  activePageFileName?: string | null,
): {
  document: DashboardProjectDocument
  projectSchema: ProjectSchema
  initialPage: string | undefined
  viewport: { width: number; height: number }
  rootAttributes: {
    'data-dashboard-root': ''
    'data-project-root': ''
    'data-project-theme': 'light' | 'dark'
  }
  rootStyle: ProjectRootStyle
} {
  const document = decodeDashboardProjectDocument(input)
  const { initialPage, page } = resolvePage(document, requestedPageId, activePageFileName)
  const pageTheme = page?.meta?.easyDashboard?.theme
  const mode = pageTheme?.mode ?? document.presentation.theme.mode
  const tokens = {
    ...safeThemeTokens(document.presentation.theme.tokens),
    ...safeThemeTokens(pageTheme?.tokens ?? {}),
  }
  const viewportSchema: ProjectSchema = page
    ? {
        ...document.editorSchema,
        componentsTree: [page],
      }
    : document.editorSchema

  return {
    document,
    projectSchema: document.editorSchema,
    initialPage,
    viewport: getViewportFromSchema(viewportSchema),
    rootAttributes: {
      'data-dashboard-root': '',
      'data-project-root': '',
      'data-project-theme': mode,
    },
    rootStyle: {
      colorScheme: mode,
      ...semanticThemeTokens[mode],
      ...tokens,
    },
  }
}
