import { DEFAULT_DASHBOARD_THEME } from '@/features/projects/project-document'
import type { ProjectSchema, RootSchema } from '@easy-editor/core'

export const defaultRootSchema: RootSchema = {
  id: 'page-home-root',
  docId: 'page-home',
  fileName: 'home',
  fileDesc: '首页',
  componentName: 'Root',
  props: {
    backgroundColor: 'var(--dashboard-background)',
    className: 'page',
  },
  isRoot: true,
  meta: {
    easyDashboard: {
      pageId: 'page-home',
    },
  },
  $dashboard: {
    rect: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    },
  },
  children: [],
}

export const defaultProjectSchema: ProjectSchema = {
  version: '1.0.0',
  meta: {
    easyDashboard: {
      documentVersion: 1,
      startPageId: 'page-home',
      theme: DEFAULT_DASHBOARD_THEME,
    },
  },
  componentsTree: [
    {
      ...defaultRootSchema,
      fileName: 'home',
      fileDesc: '首页',
      children: [],
    },
  ],
}
