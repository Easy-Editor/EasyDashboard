// 一级分类定义
export const MaterialGroup = {
  INNER: 'inner',
  BASIC: 'basic',
  CHART: 'chart',
  DISPLAY: 'display',
  INTERACTION: 'interaction',
  MEDIA: 'media',
  MAP: 'map',
} as const

export type MaterialGroup = (typeof MaterialGroup)[keyof typeof MaterialGroup]

// 一级分类中文名称映射
export const MaterialGroupLabel: Record<MaterialGroup, string> = {
  [MaterialGroup.INNER]: '内部组件',
  [MaterialGroup.BASIC]: '基础组件',
  [MaterialGroup.CHART]: '图表组件',
  [MaterialGroup.DISPLAY]: '展示组件',
  [MaterialGroup.INTERACTION]: '交互组件',
  [MaterialGroup.MEDIA]: '媒体组件',
  [MaterialGroup.MAP]: '地图组件',
}

// 二级分类定义
export const MaterialCategory = {
  // BASIC 基础组件
  TEXT: 'text',
  LAYOUT: 'layout',
  CONTAINER: 'container',

  // CHART 图表组件
  BAR: 'bar',
  LINE: 'line',
  PIE: 'pie',
  GAUGE: 'gauge',
  RADAR: 'radar',
  SCATTER: 'scatter',

  // DISPLAY 展示组件
  LIST: 'list',
  TABLE: 'table',
  CARD: 'card',
  PROGRESS: 'progress',
  CAROUSEL: 'carousel',

  // INTERACTION 交互组件
  BUTTON: 'button',
  INPUT: 'input',
  SELECT: 'select',
  FORM: 'form',

  // MEDIA 媒体组件
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',

  // MAP 地图组件
  MAP_BASE: 'map-base',
  MAP_LAYER: 'map-layer',
} as const

export type MaterialCategory = (typeof MaterialCategory)[keyof typeof MaterialCategory]

// 二级分类中文名称映射
export const MaterialCategoryLabel: Record<MaterialCategory, string> = {
  // BASIC
  [MaterialCategory.TEXT]: '文本',
  [MaterialCategory.LAYOUT]: '布局',
  [MaterialCategory.CONTAINER]: '容器',

  // CHART
  [MaterialCategory.BAR]: '柱状图',
  [MaterialCategory.LINE]: '折线图',
  [MaterialCategory.PIE]: '饼图',
  [MaterialCategory.GAUGE]: '仪表盘',
  [MaterialCategory.RADAR]: '雷达图',
  [MaterialCategory.SCATTER]: '散点图',

  // DISPLAY
  [MaterialCategory.LIST]: '列表',
  [MaterialCategory.TABLE]: '表格',
  [MaterialCategory.CARD]: '卡片',
  [MaterialCategory.PROGRESS]: '进度条',
  [MaterialCategory.CAROUSEL]: '轮播',

  // INTERACTION
  [MaterialCategory.BUTTON]: '按钮',
  [MaterialCategory.INPUT]: '输入框',
  [MaterialCategory.SELECT]: '选择器',
  [MaterialCategory.FORM]: '表单',

  // MEDIA
  [MaterialCategory.IMAGE]: '图片',
  [MaterialCategory.VIDEO]: '视频',
  [MaterialCategory.AUDIO]: '音频',

  // MAP
  [MaterialCategory.MAP_BASE]: '基础地图',
  [MaterialCategory.MAP_LAYER]: '地图图层',
}

// 分类关系映射（可选，用于验证）
export const CategoryGroupMap: Record<MaterialCategory, MaterialGroup> = {
  // BASIC
  [MaterialCategory.TEXT]: MaterialGroup.BASIC,
  [MaterialCategory.LAYOUT]: MaterialGroup.BASIC,
  [MaterialCategory.CONTAINER]: MaterialGroup.BASIC,

  // CHART
  [MaterialCategory.BAR]: MaterialGroup.CHART,
  [MaterialCategory.LINE]: MaterialGroup.CHART,
  [MaterialCategory.PIE]: MaterialGroup.CHART,
  [MaterialCategory.GAUGE]: MaterialGroup.CHART,
  [MaterialCategory.RADAR]: MaterialGroup.CHART,
  [MaterialCategory.SCATTER]: MaterialGroup.CHART,

  // DISPLAY
  [MaterialCategory.LIST]: MaterialGroup.DISPLAY,
  [MaterialCategory.TABLE]: MaterialGroup.DISPLAY,
  [MaterialCategory.CARD]: MaterialGroup.DISPLAY,
  [MaterialCategory.PROGRESS]: MaterialGroup.DISPLAY,
  [MaterialCategory.CAROUSEL]: MaterialGroup.DISPLAY,

  // INTERACTION
  [MaterialCategory.BUTTON]: MaterialGroup.INTERACTION,
  [MaterialCategory.INPUT]: MaterialGroup.INTERACTION,
  [MaterialCategory.SELECT]: MaterialGroup.INTERACTION,
  [MaterialCategory.FORM]: MaterialGroup.INTERACTION,

  // MEDIA
  [MaterialCategory.IMAGE]: MaterialGroup.MEDIA,
  [MaterialCategory.VIDEO]: MaterialGroup.MEDIA,
  [MaterialCategory.AUDIO]: MaterialGroup.MEDIA,

  // MAP
  [MaterialCategory.MAP_BASE]: MaterialGroup.MAP,
  [MaterialCategory.MAP_LAYER]: MaterialGroup.MAP,
}
