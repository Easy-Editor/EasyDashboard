import type { ProjectSchema } from '@easy-editor/core'

/**
 * Remote materials that the built-in dashboard Agent is allowed to insert.
 *
 * Keep this list independent from the editor defaults so persisted Agent
 * documents can recover the pinned material descriptors after an isolated
 * EasyEditor Host round-trip.
 */
export const defaultAgentComponentsMap = [
  {
    devMode: 'proCode',
    componentName: 'Text',
    package: '@easy-editor/materials-dashboard-text',
    version: '0.0.22',
    globalName: 'EasyEditorMaterialsText',
  },
  {
    devMode: 'proCode',
    componentName: 'BarChart',
    package: '@easy-editor/materials-dashboard-bar-chart',
    version: '0.0.7',
    globalName: 'EasyEditorMaterialsBarChart',
  },
  {
    devMode: 'proCode',
    componentName: 'LineChart',
    package: '@easy-editor/materials-dashboard-line-chart',
    version: '0.0.7',
    globalName: 'EasyEditorMaterialsLineChart',
  },
  {
    devMode: 'proCode',
    componentName: 'PieChart',
    package: '@easy-editor/materials-dashboard-pie-chart',
    version: '0.0.7',
    globalName: 'EasyEditorMaterialsPieChart',
  },
  {
    devMode: 'proCode',
    componentName: 'NumberFlip',
    package: '@easy-editor/materials-dashboard-number-flip',
    version: '0.0.7',
    globalName: 'EasyEditorMaterialsNumberFlip',
  },
  {
    devMode: 'proCode',
    componentName: 'Progress',
    package: '@easy-editor/materials-dashboard-progress',
    version: '0.0.7',
    globalName: 'EasyEditorMaterialsProgress',
  },
  {
    devMode: 'proCode',
    componentName: 'ScrollList',
    package: '@easy-editor/materials-dashboard-scroll-list',
    version: '0.0.7',
    globalName: 'EasyEditorMaterialsScrollList',
  },
  {
    devMode: 'proCode',
    componentName: 'GeoMap',
    package: '@easy-editor/materials-dashboard-geo-map',
    version: '0.0.6',
    globalName: 'EasyEditorMaterialsGeoMap',
  },
] satisfies NonNullable<ProjectSchema['componentsMap']>
