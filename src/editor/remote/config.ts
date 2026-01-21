/**
 * Remote Resource Config
 * 远程资源配置
 */

import type { RemoteMaterialConfig } from './managers/material-manager'
import type { RemoteSetterConfig } from './managers/setter-manager'

/** 远程物料配置列表 */
export const remoteMaterialsConfig: RemoteMaterialConfig[] = [
  // basic
  {
    package: '@easy-editor/materials-dashboard-text',
    version: '0.0.14',
    globalName: 'EasyEditorMaterialsText',
    enabled: true,
  },
  // media
  {
    package: '@easy-editor/materials-dashboard-audio',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsAudio',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-filter',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsFilter',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-image',
    version: '0.0.2',
    globalName: 'EasyEditorMaterialsImage',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-video',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsVideo',
    enabled: true,
  },
  // chart
  {
    package: '@easy-editor/materials-dashboard-bar-chart',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsBarChart',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-gauge-chart',
    version: '0.0.2',
    globalName: 'EasyEditorMaterialsGaugeChart',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-line-chart',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsLineChart',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-pie-chart',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsPieChart',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-radar-chart',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsRadarChart',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-scatter-chart',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsScatterChart',
    enabled: true,
  },
  // display
  {
    package: '@easy-editor/materials-dashboard-carousel',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsCarousel',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-number-flip',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsNumberFlip',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-progress',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsProgress',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-scroll-list',
    version: '0.0.3',
    globalName: 'EasyEditorMaterialsScrollList',
    enabled: true,
  },
  // interaction
  {
    package: '@easy-editor/materials-dashboard-button',
    version: '0.0.2',
    globalName: 'EasyEditorMaterialsButton',
    enabled: true,
  },
  // map
  {
    package: '@easy-editor/materials-dashboard-fly-line',
    version: '0.0.2',
    globalName: 'EasyEditorMaterialsFlyLine',
    enabled: true,
  },
  {
    package: '@easy-editor/materials-dashboard-geo-map',
    version: '0.0.2',
    globalName: 'EasyEditorMaterialsGeoMap',
    enabled: true,
  },
]

/** 远程设置器配置列表 */
export const remoteSettersConfig: RemoteSetterConfig[] = [
  {
    package: '@easy-editor/setters',
    version: 'latest',
    globalName: 'EasyEditorSetters',
    enabled: true,
  },
]
