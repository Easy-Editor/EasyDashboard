export const LINKED_MATERIALS_ROUTE_PREFIX = '/__easy-dashboard-linked-materials'

export const LINKED_SCROLL_LIST_PACKAGE = '@easy-editor/materials-dashboard-scroll-list'
export const LINKED_SCROLL_LIST_VERSION = '0.0.8'

export const LINKED_SCROLL_LIST_FILES = ['dist/index.min.js', 'dist/meta.min.js', 'dist/component.min.js'] as const
export const LINKED_PIE_CHART_PACKAGE = '@easy-editor/materials-dashboard-pie-chart'
export const LINKED_PIE_CHART_VERSION = '0.0.8'
export const LINKED_PIE_CHART_FILES = ['dist/index.min.js', 'dist/meta.min.js', 'dist/component.min.js'] as const

export type LinkedScrollListFile = (typeof LINKED_SCROLL_LIST_FILES)[number]
export type LinkedPieChartFile = (typeof LINKED_PIE_CHART_FILES)[number]

const linkedScrollListFileSet = new Set<string>(LINKED_SCROLL_LIST_FILES)
const linkedPieChartFileSet = new Set<string>(LINKED_PIE_CHART_FILES)

const linkedMaterials = [
  {
    slug: 'scroll-list',
    packageName: LINKED_SCROLL_LIST_PACKAGE,
    version: LINKED_SCROLL_LIST_VERSION,
    files: linkedScrollListFileSet,
  },
  {
    slug: 'pie-chart',
    packageName: LINKED_PIE_CHART_PACKAGE,
    version: LINKED_PIE_CHART_VERSION,
    files: linkedPieChartFileSet,
  },
] as const

export type LinkedMaterialSlug = (typeof linkedMaterials)[number]['slug']

export interface LinkedMaterialRequest {
  material: LinkedMaterialSlug
  file: LinkedScrollListFile | LinkedPieChartFile
}

export function isLinkedMaterialsRuntimeEnabled(env: {
  DEV?: boolean
  VITE_EASY_DASHBOARD_USE_LINKED_MATERIALS?: string
}): boolean {
  return env.DEV === true && env.VITE_EASY_DASHBOARD_USE_LINKED_MATERIALS === 'true'
}

export function resolveLinkedMaterialUrl(packageName: string, file: string, enabled: boolean): string | undefined {
  if (!enabled) return undefined

  const material = linkedMaterials.find(candidate => candidate.packageName === packageName && candidate.files.has(file))
  if (!material) return undefined

  return `${LINKED_MATERIALS_ROUTE_PREFIX}/${material.slug}/${material.version}/${file}`
}

export function resolveLinkedMaterialRequest(rawUrl: string | undefined): LinkedMaterialRequest | undefined {
  if (!rawUrl) return undefined

  const rawPathname = rawUrl.split('?', 1)[0]
  if (!rawPathname || rawPathname.includes('%') || rawPathname.includes('\\') || rawPathname.includes('..')) {
    return undefined
  }

  for (const material of linkedMaterials) {
    const routePrefix = `${LINKED_MATERIALS_ROUTE_PREFIX}/${material.slug}/${material.version}/`
    if (!rawPathname.startsWith(routePrefix)) continue

    const file = rawPathname.slice(routePrefix.length)
    if (!material.files.has(file)) return undefined

    return {
      material: material.slug,
      file: file as LinkedScrollListFile | LinkedPieChartFile,
    }
  }

  return undefined
}
