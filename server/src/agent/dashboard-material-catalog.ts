export const DASHBOARD_AGENT_MATERIAL_CATALOG_VERSION = '3.10.0'
export const DASHBOARD_AGENT_LINKED_PIE_CHART_CATALOG_VERSION = '3.10.0-linked-pie-0.0.8'

export interface DashboardAgentMaterialCatalogOptions {
  linkedPieChartStyles?: boolean
}

const sharedWritableFields = {
  'shared.rect': {
    type: 'rect',
    coordinateSpace: 'canvas-global-absolute',
    required: ['x', 'y', 'width', 'height'],
    example: { x: 48, y: 126, width: 420, height: 172 },
  },
  'shared.title': { type: 'string' },
  'shared.visibility': { type: 'boolean' },
  'props.background': { type: 'string', example: '#ffffff' },
  'props.opacity': { type: 'number', minimum: 0, maximum: 100, example: 100 },
} as const

const staticDataField = (rowShape: Record<string, string>, staticData: Array<Record<string, unknown>>) => ({
  type: 'object',
  description:
    'Remote material data source configuration. For demo data use sourceType=static and put rows in staticData. fieldMappings is optional when source keys already match component fields.',
  required: ['sourceType', 'staticData'],
  rowShape,
  example: { sourceType: 'static', staticData },
})

/**
 * Model-facing material subset backed by the browser Host manifest. Remote
 * component names intentionally use their real metadata names so the executor
 * and the product editor resolve the same material and the same field IDs.
 */
export const DASHBOARD_AGENT_MATERIAL_CATALOG = {
  canvas: {
    width: 1920,
    height: 1080,
    guidance: [
      '现有物料优先：文字、指标、地图、图表、进度和列表使用可独立编辑的真实物料；Div 只做结构和装饰。',
      '空白画布先插入 Div 分区，再用真实 id 归组；归组不改子节点 shared.rect。',
      '所有节点的 shared.rect.x/y 始终是相对 1920×1080 画布原点的全局绝对坐标；即使 parentId 指向 Div，也绝不转换为父容器局部坐标。',
      '组件树按装饰、头部、左侧、中部、右侧和底部分组，禁止平铺。',
      'DashboardScene 仅作局部兜底，禁止承载整屏或替代普通物料。',
      'GlobeScene 是可编辑的一等中央地球舞台物料，不是截图背景或整屏容器；标题、时间、左右 HUD、图表和列表仍须使用 Div 与普通物料。',
      '有参考图时匹配其形状、密度与明暗；禁止把科技大屏默认做成高亮描边、通体发光和圆角卡片。',
      '业务图标用 DashboardIcon，禁止文字字符或 emoji 冒充。',
    ],
  },
  materials: [
    {
      componentName: 'Root',
      displayName: '画布根节点',
      insertable: false,
      writableFields: {
        'props.backgroundColor': { type: 'string', example: '#eef3f7' },
      },
    },
    {
      componentName: 'Div',
      displayName: 'Div 容器',
      category: 'structure',
      insertable: true,
      useFor: ['语义分区', '卡片表面', '头底压边', '背景渐变', '组件树分组'],
      guidance: [
        'Div 必须设置 shared.title；子节点坐标仍是画布绝对坐标；归组只 move，不改 rect。',
        '左右 HUD 侧翼用 div.panelShape 与 div.panelInset；安全装饰优先用 div.visualPreset：hud-panel、metric-axis、corner-frame，禁止用超长 CSS gradient 字符串手绘节点或角框。',
      ],
      writableFields: {
        'props.background': {
          type: 'string',
          example: 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(237,242,247,0.96))',
        },
        'props.borderColor': { type: 'string', example: '#e2e7ed' },
        'props.borderWidth': { type: 'number', minimum: 0, maximum: 12, multipleOf: 1, example: 1 },
        'props.borderRadius': { type: 'number', minimum: 0, maximum: 64, multipleOf: 1, example: 6 },
        'props.opacity': { type: 'number', minimum: 0, maximum: 100, multipleOf: 1, example: 100 },
        'div.panelShape': {
          type: 'string',
          enum: ['rect', 'hud-left', 'hud-right'],
          example: 'hud-left',
        },
        'div.panelInset': {
          type: 'number',
          minimum: 0,
          maximum: 96,
          multipleOf: 1,
          example: 24,
        },
        'div.visualPreset': {
          type: 'string',
          enum: ['none', 'hud-panel', 'metric-axis', 'corner-frame'],
          example: 'metric-axis',
        },
        'div.enterAnimation': {
          type: 'string',
          enum: ['none', 'fade', 'slide-left', 'slide-right', 'rise'],
          example: 'fade',
        },
        'div.enterDuration': {
          type: 'number',
          minimum: 100,
          maximum: 10_000,
          multipleOf: 50,
          example: 700,
        },
        'div.enterDelay': {
          type: 'number',
          minimum: 0,
          maximum: 30_000,
          multipleOf: 50,
          example: 240,
        },
        'props.overflow': { type: 'string', enum: ['visible', 'hidden'], example: 'hidden' },
        'props.shadowColor': { type: 'string', example: 'rgba(29, 37, 48, 0.10)' },
        'props.shadowBlur': { type: 'number', minimum: 0, maximum: 80, multipleOf: 1, example: 18 },
        'props.shadowOffsetY': { type: 'number', minimum: -24, maximum: 24, multipleOf: 1, example: 6 },
        'shared.rect': sharedWritableFields['shared.rect'],
        'shared.title': sharedWritableFields['shared.title'],
        'shared.visibility': sharedWritableFields['shared.visibility'],
      },
    },
    {
      componentName: 'DashboardIcon',
      insertable: true,
      writableFields: {
        'dashboardIcon.icon': {
          type: 'string',
          enum: ['factory', 'sprout', 'government', 'waves', 'island', 'mine', 'trees'],
          example: 'factory',
        },
        'dashboardIcon.color': { type: 'string', example: '#8fdcff' },
        'shared.rect': sharedWritableFields['shared.rect'],
        'shared.title': sharedWritableFields['shared.title'],
      },
    },
    {
      componentName: 'EasyEditorMaterialsText',
      displayName: 'Text',
      insertable: true,
      useFor: ['大屏标题', '模块标题', 'KPI 标签', '单位', '说明文字'],
      writableFields: {
        'data.config': staticDataField({ text: 'string (required)' }, [{ text: '银行2022年度可视化财报' }]),
        'props.fontSize': { type: 'number', minimum: 8, maximum: 240, multipleOf: 1, example: 38 },
        'props.fontWeight': { type: 'string', enum: ['normal', 'bold'], example: 'bold' },
        'props.color': { type: 'string', example: '#252d36' },
        'props.lineHeight': { type: 'number', minimum: 0.5, maximum: 4, multipleOf: 0.1, example: 1.4 },
        'props.textAlign': { type: 'string', enum: ['left', 'center', 'right'], example: 'left' },
        'props.verticalAlign': { type: 'string', enum: ['top', 'middle', 'bottom'], example: 'middle' },
        'props.glowEnable': { type: 'boolean', example: false },
        'props.glowColor': { type: 'string', example: '#c9a66e' },
        ...sharedWritableFields,
      },
    },
    {
      componentName: 'EasyEditorMaterialsNumberFlip',
      displayName: 'NumberFlip',
      insertable: true,
      guidance: ['Use a separate Text node for the KPI label; this node owns the numeric value and trend only.'],
      writableFields: {
        'data.config': staticDataField({ value: 'number (required)' }, [{ value: 3023.34 }]),
        'props.decimals': { type: 'number', minimum: 0, maximum: 10, example: 2 },
        'props.separator': { type: 'boolean', example: true },
        'props.prefix': { type: 'string', example: '' },
        'props.suffix': { type: 'string', example: ' 亿元' },
        'props.trendEnable': { type: 'boolean', example: true },
        'props.trendValue': { type: 'number', example: 4.08 },
        'props.trendType': { type: 'string', enum: ['up', 'down', 'flat'], example: 'up' },
        'props.trendSuffix': { type: 'string', example: '%' },
        'props.fontSize': { type: 'number', minimum: 12, maximum: 120, multipleOf: 2, example: 44 },
        'props.fontFamily': { type: 'string', enum: ['digital', 'default'], example: 'default' },
        'props.color': { type: 'string', example: '#252d36' },
        'props.glowIntensity': { type: 'number', minimum: 0, maximum: 2, multipleOf: 0.1, example: 0 },
        ...sharedWritableFields,
      },
    },
    {
      componentName: 'DateTime',
      displayName: '实时日期时间',
      category: 'display',
      insertable: true,
      useFor: ['大屏右上角日期', '实时钟表', '运行时日期时间'],
      guidance: [
        '使用运行时系统时间，不要把某一刻的日期或时间写成静态 Text。日期与时间字号不同时插入两个 DateTime 节点。',
        '银行财报日期使用 dateFormat=dot；时间使用 timeFormat=hms、hour12=false；固定中国口径时使用 timeZone=Asia/Shanghai。',
      ],
      writableFields: {
        'dateTime.mode': { type: 'string', enum: ['date', 'time', 'datetime'], example: 'time' },
        'dateTime.locale': { type: 'string', enum: ['zh-CN', 'en-US'], example: 'zh-CN' },
        'dateTime.dateFormat': {
          type: 'string',
          enum: ['localized', 'dot', 'dash', 'slash'],
          example: 'dot',
        },
        'dateTime.timeFormat': { type: 'string', enum: ['localized', 'hm', 'hms'], example: 'hms' },
        'dateTime.hour12': { type: 'boolean', example: false },
        'dateTime.timeZone': {
          type: 'string',
          enum: ['local', 'Asia/Shanghai', 'UTC'],
          example: 'Asia/Shanghai',
        },
        'dateTime.updateInterval': { type: 'string', enum: ['second', 'minute'], example: 'second' },
        'dateTime.color': { type: 'string', example: '#252d36' },
        'dateTime.fontSize': { type: 'number', minimum: 8, maximum: 120, multipleOf: 1, example: 30 },
        'dateTime.fontWeight': { type: 'number', minimum: 100, maximum: 900, multipleOf: 50, example: 750 },
        'dateTime.textAlign': { type: 'string', enum: ['left', 'center', 'right'], example: 'right' },
        'dateTime.letterSpacing': { type: 'number', minimum: -2, maximum: 12, multipleOf: 0.5, example: 1 },
        'shared.rect': sharedWritableFields['shared.rect'],
        'shared.title': sharedWritableFields['shared.title'],
        'shared.visibility': sharedWritableFields['shared.visibility'],
      },
    },
    {
      componentName: 'EasyEditorMaterialsGeoMap',
      displayName: 'GeoMap',
      insertable: true,
      guidance: [
        'Use mapType=china for province analysis. showScatter=true and glowEffect=true provide native ripple motion.',
        'For a 1920x1080 China bank dashboard, keep scatterSymbolSize between 4 and 8 so ripple markers do not cover the provinces.',
      ],
      writableFields: {
        'data.config': staticDataField({ name: 'string (required)', value: 'number (required)' }, [
          { name: '浙江省', value: 92 },
          { name: '广东省', value: 78 },
          { name: '四川省', value: 66 },
        ]),
        'props.mapType': { type: 'string', enum: ['china', 'world'], example: 'china' },
        'props.roam': { type: 'boolean', example: false },
        'props.showVisualMap': { type: 'boolean', example: false },
        'props.showTooltip': { type: 'boolean', example: true },
        'props.showScatter': { type: 'boolean', example: true },
        'props.scatterSymbolSize': { type: 'number', minimum: 4, maximum: 30, multipleOf: 1, example: 6 },
        'props.glowEffect': { type: 'boolean', example: true },
        'props.colors': { type: 'array<string>', example: ['#d9e1eb', '#c9a66e', '#d7192d'] },
        ...sharedWritableFields,
      },
    },
    {
      componentName: 'EasyEditorMaterialsBarChart',
      displayName: 'BarChart',
      insertable: true,
      guidance: ['ECharts entry animation is native. Use name/value1/value2 rows with xField=name and yFields.'],
      writableFields: {
        'data.config': staticDataField(
          { name: 'string (required)', value1: 'number (required)', value2: 'number (optional)' },
          [
            { name: '02月', value1: 320, value2: 650 },
            { name: '04月', value1: 360, value2: 610 },
          ],
        ),
        'props.xField': { type: 'string', example: 'name' },
        'props.yFields': { type: 'array<string>', example: ['value1', 'value2'] },
        'props.layout': { type: 'string', enum: ['vertical', 'horizontal'], example: 'vertical' },
        'props.stacked': { type: 'boolean', example: false },
        'props.gradient': { type: 'boolean', example: true },
        'props.borderRadius': { type: 'number', minimum: 0, maximum: 20, multipleOf: 1, example: 4 },
        'props.colors': { type: 'array<string>', example: ['#c9a66e', '#d7192d'] },
        'props.showGrid': { type: 'boolean', example: true },
        'props.showLegend': { type: 'boolean', example: true },
        'props.legendPosition': { type: 'string', enum: ['top', 'bottom', 'left', 'right'], example: 'top' },
        ...sharedWritableFields,
      },
    },
    {
      componentName: 'EasyEditorMaterialsLineChart',
      displayName: 'LineChart',
      insertable: true,
      guidance: ['ECharts entry animation is native. Small line charts may be used as KPI sparklines.'],
      writableFields: {
        'data.config': staticDataField(
          { name: 'string (required)', value1: 'number (required)', value2: 'number (optional)' },
          [
            { name: '02月', value1: 680, value2: 350 },
            { name: '04月', value1: 520, value2: 310 },
            { name: '06月', value1: 710, value2: 380 },
          ],
        ),
        'props.xField': { type: 'string', example: 'name' },
        'props.yFields': { type: 'array<string>', example: ['value1', 'value2'] },
        'props.colors': { type: 'array<string>', example: ['#d7192d', '#c9a66e'] },
        'props.strokeWidth': { type: 'number', minimum: 1, maximum: 10, multipleOf: 1, example: 2 },
        'props.smooth': { type: 'boolean', example: true },
        'props.areaFill': { type: 'boolean', example: false },
        'props.glowEffect': { type: 'boolean', example: false },
        'props.showGrid': { type: 'boolean', example: true },
        'props.showLegend': { type: 'boolean', example: true },
        'props.legendPosition': { type: 'string', enum: ['top', 'bottom', 'left', 'right'], example: 'top' },
        'props.showTooltip': { type: 'boolean', example: true },
        ...sharedWritableFields,
      },
    },
    {
      componentName: 'EasyEditorMaterialsPieChart',
      displayName: 'PieChart',
      insertable: true,
      guidance: ['Radius values are percentages from 0 to 100.'],
      writableFields: {
        'data.config': staticDataField({ name: 'string (required)', value: 'number (required)' }, [
          { name: '手机银行', value: 42 },
          { name: '微信银行', value: 22 },
          { name: '网上银行', value: 18 },
        ]),
        'props.innerRadius': { type: 'number', minimum: 0, maximum: 100, multipleOf: 5, example: 50 },
        'props.outerRadius': { type: 'number', minimum: 50, maximum: 100, multipleOf: 5, example: 80 },
        'props.colors': { type: 'array<string>', example: ['#d7192d', '#b7c0cf', '#e9dfcc', '#c9a66e'] },
        'props.roseType': { type: 'boolean', example: false },
        'props.glowEffect': { type: 'boolean', example: false },
        'props.showLabel': { type: 'boolean', example: true },
        'props.labelType': { type: 'string', enum: ['percent', 'value', 'name'], example: 'percent' },
        'props.showLegend': { type: 'boolean', example: true },
        'props.legendPosition': { type: 'string', enum: ['top', 'bottom', 'left', 'right'], example: 'right' },
        'props.showTooltip': { type: 'boolean', example: true },
        ...sharedWritableFields,
      },
    },
    {
      componentName: 'EasyEditorMaterialsProgress',
      displayName: 'Progress',
      insertable: true,
      guidance: [
        'Use separate Progress nodes for independently editable shareholder ranking rows or capability indicators.',
      ],
      writableFields: {
        'data.config': staticDataField({ value: 'number (required)' }, [{ value: 32 }]),
        'props.maxValue': { type: 'number', example: 100 },
        'props.valueFormat': { type: 'string', enum: ['percent', 'number'], example: 'percent' },
        'props.type': { type: 'string', enum: ['ring', 'bar'], example: 'bar' },
        'props.showValue': { type: 'boolean', example: true },
        'props.showLabel': { type: 'boolean', example: true },
        'props.label': { type: 'string', example: '证券金融股份有限公司A' },
        'props.strokeWidthRatio': {
          type: 'number',
          minimum: 0.02,
          maximum: 0.2,
          multipleOf: 0.01,
          example: 0.06,
        },
        'props.trackColor': { type: 'string', example: '#e4e8ed' },
        'props.progressColor': { type: 'string', example: '#c9a66e' },
        'props.gradientEnable': { type: 'boolean', example: false },
        'props.gradientColors': { type: 'array<string>', example: ['#d9c29a', '#b68a4f'] },
        ...sharedWritableFields,
      },
    },
    {
      componentName: 'EasyEditorMaterialsScrollList',
      displayName: 'ScrollList',
      insertable: true,
      guidance: [
        'Set displayStyle=ranking-track for No. tags, thin tracks, node markers and right-aligned values.',
        'Always map rank, name and value.',
        'No auto-scroll; use one local DashboardScene table only when continuous rolling is required.',
      ],
      writableFields: {
        'data.config': staticDataField(
          { rank: 'number (required)', name: 'string (required)', value: 'number (required)' },
          [
            { rank: 1, name: '明星理财A', value: 98 },
            { rank: 2, name: '明星理财B', value: 91 },
          ],
        ),
        'props.maxItems': { type: 'number', minimum: 1, maximum: 20, example: 5 },
        'props.displayStyle': { type: 'string', enum: ['standard', 'ranking-track'], example: 'standard' },
        'props.showRank': { type: 'boolean', example: true },
        'props.showMedal': { type: 'boolean', example: true },
        'props.progressBarEnable': { type: 'boolean', example: true },
        'props.progressBarGradient': { type: 'boolean', example: false },
        'props.glowEnable': { type: 'boolean', example: false },
        'props.valueFormat': { type: 'string', enum: ['number', 'currency', 'percent'], example: 'number' },
        'props.valuePrefix': { type: 'string', example: '' },
        'props.valueSuffix': { type: 'string', example: '' },
        'props.progressBarColors': { type: 'array<string>', example: ['#d9c29a', '#b68a4f'] },
        'props.nameColor': { type: 'string', example: '#4b5563' },
        'props.valueColor': { type: 'string', example: '#252d36' },
        'props.backgroundColor': { type: 'string', example: '#ffffff' },
        'props.itemBackgroundColor': { type: 'string', example: '#f4f6f8' },
        ...sharedWritableFields,
      },
    },
    {
      componentName: 'GlobeScene',
      displayName: '全球地球场景',
      category: 'map-stage',
      insertable: true,
      useFor: ['中央旋转地球', '全球自然资源空间主视觉', '深空星点与地球大气光效果'],
      guidance: [
        'GlobeScene 是一等本地物料，只用于中央地球舞台；应放在独立的中央 Div 分组中，不能承载标题、日期时间、左右 HUD、图表或列表。',
        '禁止把 GlobeScene 拉伸为整屏背景来替代普通物料，也不要在字段中放入 URL、文件路径、截图、shader 或 JavaScript。',
        'globeScene.background、oceanColor、landColor、atmosphereColor 只接受单一安全颜色；径向或线性渐变必须写在外层 Div 的 props.background，禁止把 gradient 写入 GlobeScene 颜色字段。',
        '默认 centerLongitude=118、centerLatitude=18 呈现亚洲—西太平洋；参考动图式首次推进使用 introAnimation=true、introDuration≈2700，慢速自转使用 autoRotate=true、rotationSpeed 约 0.4..1.2。',
        '需要 GIF 式强昼夜层次时，不要用截图或自定义组件：降低 surfaceBrightness 与 ambientLight、保留 daylightIntensity，并用 lightAzimuth 控制亮面方位；右侧偏亮通常使用 lightAzimuth 约 25..55。',
        '资源点 markers 最多 24 个，仅接受经纬度、短标签、颜色与数值；prefers-reduced-motion 下地球自动停止且所有入场动画归于稳态。',
        '左右 HUD 如需分阶段入场，分别给其 Div 使用 div.enterAnimation 与不同 div.enterDelay；HUD 不得作为 GlobeScene 子内容随地球缩放。',
      ],
      writableFields: {
        'globeScene.background': { type: 'string', example: '#020814' },
        'globeScene.starDensity': { type: 'number', minimum: 0, maximum: 1, multipleOf: 0.05, example: 0.72 },
        'globeScene.oceanColor': { type: 'string', example: '#04162c' },
        'globeScene.landColor': { type: 'string', example: '#173f69' },
        'globeScene.atmosphereColor': { type: 'string', example: '#6bdcff' },
        'globeScene.surfaceBrightness': {
          type: 'number',
          minimum: 0.35,
          maximum: 1.2,
          multipleOf: 0.05,
          example: 0.7,
        },
        'globeScene.ambientLight': {
          type: 'number',
          minimum: 0.04,
          maximum: 0.5,
          multipleOf: 0.01,
          example: 0.14,
        },
        'globeScene.daylightIntensity': {
          type: 'number',
          minimum: 0.3,
          maximum: 1.4,
          multipleOf: 0.05,
          example: 0.9,
        },
        'globeScene.lightAzimuth': {
          type: 'number',
          minimum: -180,
          maximum: 180,
          multipleOf: 1,
          example: 35,
        },
        'globeScene.autoRotate': { type: 'boolean', example: true },
        'globeScene.rotationSpeed': { type: 'number', minimum: -8, maximum: 8, multipleOf: 0.1, example: 0.8 },
        'globeScene.introAnimation': { type: 'boolean', example: true },
        'globeScene.introDuration': {
          type: 'number',
          minimum: 600,
          maximum: 10_000,
          multipleOf: 100,
          example: 2700,
        },
        'globeScene.introLoop': { type: 'boolean', example: false },
        'globeScene.centerLongitude': {
          type: 'number',
          minimum: -180,
          maximum: 180,
          multipleOf: 1,
          example: 118,
        },
        'globeScene.centerLatitude': {
          type: 'number',
          minimum: -70,
          maximum: 70,
          multipleOf: 1,
          example: 18,
        },
        'globeScene.globeScale': {
          type: 'number',
          minimum: 0.35,
          maximum: 1.45,
          multipleOf: 0.05,
          example: 1,
        },
        'globeScene.markers': {
          type: 'array',
          maxItems: 24,
          description:
            'Pure local resource markers. Each item only accepts longitude, latitude, optional short label, safe CSS color and scalar value.',
          itemShape: {
            longitude: 'number -180..180 (required)',
            latitude: 'number -90..90 (required)',
            label: 'string maxLength=36 (optional)',
            color: 'safe color string (optional)',
            value: 'number|string maxLength=36 (optional)',
          },
          example: [
            { longitude: 116.4, latitude: 39.9, label: '北京', color: '#61e9ff', value: 96 },
            { longitude: 139.7, latitude: 35.7, label: '东京', color: '#57baff', value: 76 },
          ],
        },
        'shared.rect': sharedWritableFields['shared.rect'],
        'shared.title': sharedWritableFields['shared.title'],
        'shared.visibility': sharedWritableFields['shared.visibility'],
      },
    },
    {
      componentName: 'DashboardScene',
      displayName: '局部自定义区域',
      category: 'custom-fallback',
      insertable: true,
      guidance: [
        '仅当现有物料确实无法表达某个局部效果时使用，并在 plan 中说明哪个能力缺口导致回退。',
        '禁止用 DashboardScene 承载整张大屏。单个自定义区域面积不得超过画布 25%，所有自定义区域合计不得超过 35%。',
        '局部可用 table、combo-map、cluster、line；仅单层 PieChart 无法表达双环时用 donut。每区一个 widget。',
        'table 支持 rowHeight/headerHeight/fontSize/scrollSeconds/rankIcons；combo-map 的 tabViews/provinceViews 负责真实切换；cluster 支持逐项位置、尺寸、颜色和分层；donut 最多两个 rings，并支持 chartWidthPercent/legendFontSize。',
        '修改已有 DashboardScene 的深层 widget 数据时，优先 set props.widgetData；它只浅合并唯一主 widget.data，不会替换 canvas、theme、map、widget rect 或 kind。',
        'line 支持 rows、xKey、series(label/color)、图例、坐标轴、网格、点和动画细节。',
        'Never put an image URL, data URL, local path, screenshot, or ordinary material content in props.spec.',
      ],
      writableFields: {
        'props.spec': {
          type: 'object',
          description:
            'Bounded local scene: version=1, hidden header, exactly one table/combo-map/cluster/line/donut widget.',
          example: {
            version: 1,
            canvas: { width: 420, height: 330 },
            header: { brand: '', title: '', subtitle: '', showClock: false, showHeader: false },
            theme: {
              background: '#ffffff',
              surface: '#ffffff',
              surfaceStrong: '#f4f6f8',
              text: '#252d36',
              muted: '#7f8791',
              accent: '#c9a66e',
              negative: '#d7192d',
              positive: '#19c56b',
              grid: '#d4dce5',
              border: '#e4e8ed',
            },
            widgets: [
              {
                id: 'merchant-table',
                kind: 'table',
                title: '交易商户概况',
                rect: { x: 0, y: 0, width: 420, height: 330 },
                data: {
                  columns: ['排行', '商户名称', '金额'],
                  rows: [
                    [1, '商户A', 34212],
                    [2, '商户B', 31420],
                    [3, '商户C', 28760],
                    [4, '商户D', 26540],
                    [5, '商户E', 24480],
                  ],
                  autoScroll: true,
                  scrollSeconds: 10,
                },
              },
            ],
          },
        },
        'props.widgetData': {
          type: 'object',
          description:
            'Safe shallow override for the single primary widget.data. Use for tabViews/provinceViews, cluster items/layers, table rows, line rows, or donut rings without replacing the full spec.',
          example: {
            tabViews: {
              业绩表现: {
                chart: [
                  { label: '02', profit: 350, revenue: 680 },
                  { label: '04', profit: 315, revenue: 570 },
                ],
              },
            },
            provinceViews: {
              浙江: {
                regions: [
                  { name: '浙江省', fill: '#d7192d', emphasis: true },
                  { name: '江西省', fill: '#c6a36c', emphasis: true },
                ],
              },
            },
          },
        },
        'shared.rect': sharedWritableFields['shared.rect'],
        'shared.title': sharedWritableFields['shared.title'],
        'shared.visibility': sharedWritableFields['shared.visibility'],
      },
    },
  ],
} as const

const linkedPieChartGuidance = [
  'Use displayStyle=concentric-rings for separate thin progress arcs with outside percentage labels and an optional right-side legend.',
  'Use displayStyle=tilted-donut for a restrained flattened, layered atmosphere-index donut; no glow is required.',
  'Keep displayStyle=standard for ordinary pie, donut and rose charts.',
] as const

const linkedPieChartWritableFields = {
  'props.displayStyle': {
    type: 'string',
    enum: ['standard', 'concentric-rings', 'tilted-donut'],
    example: 'standard',
  },
  'props.trackColor': { type: 'string', example: 'rgba(120, 153, 177, 0.16)' },
  'props.ringWidth': { type: 'number', minimum: 1, maximum: 18, multipleOf: 1, example: 5 },
  'props.ringGap': { type: 'number', minimum: 0, maximum: 12, multipleOf: 1, example: 3 },
  'props.tiltRatio': { type: 'number', minimum: 0.25, maximum: 1, multipleOf: 0.05, example: 0.55 },
  'props.tiltedDepth': { type: 'number', minimum: 0, maximum: 24, multipleOf: 1, example: 12 },
} as const

export function dashboardAgentMaterialCatalogVersion(options: DashboardAgentMaterialCatalogOptions = {}): string {
  return options.linkedPieChartStyles
    ? DASHBOARD_AGENT_LINKED_PIE_CHART_CATALOG_VERSION
    : DASHBOARD_AGENT_MATERIAL_CATALOG_VERSION
}

export function renderDashboardAgentMaterialCatalog(options: DashboardAgentMaterialCatalogOptions = {}): string {
  const scalar = (value: unknown): string => JSON.stringify(value)
  const fieldContract = (fieldId: string, value: unknown): string => {
    const field = value as Record<string, unknown>
    if (fieldId === 'props.spec') {
      return 'object{version:1,canvas:{width,height},header:{showHeader:false,showClock:false},theme?:{background?,surface?,surfaceStrong?,text?,muted?,accent?,negative?,positive?,grid?,border?},widgets:[one:{id?,kind:"table"|"combo-map"|"cluster"|"line"|"donut",title?,chrome?:"none",rect?:{x,y,width,height},data:{table=>columns,rows,autoScroll,rowHeight?,headerHeight?,fontSize?,scrollSeconds?,rankIcons?;combo-map=>regions?,highlights?,chart,tabs?,activeTab?,tabViews?:Record<tabKey,{chart?,regions?,highlights?,legend?,chartYDomain?,chartYTicks?,mapScale?}>,legend?,provinceTabs?,selectedProvince?,provinceViews?:Record<provinceKey,{chart?,regions?,highlights?,legend?,chartYDomain?,chartYTicks?,mapScale?}>,animate?,mapScale?,mapWidthPercent?,chartYDomain?,chartYTicks?;cluster=>items:Array<string|{id?,label,x?,y?,size?,scale?,color?,rotation?,fontSize?,fontWeight?,zIndex?,layers?:Array<{id?,color?,opacity?,scale?,rotation?,offsetX?,offsetY?,blur?}>}>,centerItem?,motion?:"float"|"none",animate?;line=>xKey,rows,series:[{key,label,color}],showLegend?,showYAxis?,showAllXTicks?,horizontalGrid?,yDomain?,yTicks?,verticalGrid?,dotRadius?,animate?;donut=>rings:[{items,innerRadius?,outerRadius?}]<=2,legendItems?,animate?,chartWidthPercent?,legendFontSize?}}]}'
    }
    if (fieldId === 'props.widgetData') {
      return 'object shallow-merged into the existing single widget.data; safe for tabViews,provinceViews,items,layers,rows,rings and visual options; never replaces spec canvas,theme,map,kind,rect'
    }
    if (fieldId === 'globeScene.markers') {
      return 'array<=24 of strict object{longitude:number[-180..180]!,latitude:number[-90..90]!,label?:string<=36,color?:safe-color,value?:number|string<=36}; no additional fields, URLs, paths, shader or JavaScript'
    }
    if (fieldId === 'globeScene.background') {
      return 'safe-solid-color only; use outer Div props.background for gradients; never use linear-gradient or radial-gradient'
    }
    if (
      fieldId === 'globeScene.oceanColor' ||
      fieldId === 'globeScene.landColor' ||
      fieldId === 'globeScene.atmosphereColor'
    ) {
      return 'hex-color only (#RGB, #RGBA, #RRGGBB or #RRGGBBAA); never use rgb, hsl or gradients'
    }
    if (fieldId === 'data.config') {
      const rowShape = field.rowShape as Record<string, string>
      const rows = Object.entries(rowShape)
        .map(([name, type]) => `${name}:${type.replace(' (required)', '!').replace(' (optional)', '?')}`)
        .join(',')
      return `object{sourceType:"static",staticData:Array<{${rows}}>,fieldMappings?:Array<{componentField:string,sourceField:string}>}`
    }
    const parts = [String(field.type ?? 'unknown')]
    if (Array.isArray(field.enum)) parts.push(`enum=${field.enum.map(scalar).join('|')}`)
    if (field.minimum !== undefined || field.maximum !== undefined) {
      parts.push(`range=${field.minimum ?? '-inf'}..${field.maximum ?? 'inf'}`)
    }
    if (field.multipleOf !== undefined) parts.push(`multipleOf=${field.multipleOf}`)
    if (Array.isArray(field.required)) parts.push(`required=${field.required.join('|')}`)
    if (field.coordinateSpace !== undefined) parts.push(`coordinateSpace=${field.coordinateSpace}`)
    return parts.join(',')
  }

  const lines = [
    `version=${dashboardAgentMaterialCatalogVersion(options)};canvas=${DASHBOARD_AGENT_MATERIAL_CATALOG.canvas.width}x${DASHBOARD_AGENT_MATERIAL_CATALOG.canvas.height}`,
    `rules=${DASHBOARD_AGENT_MATERIAL_CATALOG.canvas.guidance.join(' ')}`,
  ]
  for (const material of DASHBOARD_AGENT_MATERIAL_CATALOG.materials) {
    const linkedPieChart = options.linkedPieChartStyles && material.componentName === 'EasyEditorMaterialsPieChart'
    const guidance =
      'guidance' in material
        ? [...material.guidance, ...(linkedPieChart ? linkedPieChartGuidance : [])]
        : linkedPieChart
          ? [...linkedPieChartGuidance]
          : []
    const writableFields = linkedPieChart
      ? { ...material.writableFields, ...linkedPieChartWritableFields }
      : material.writableFields
    const qualifiers = [
      material.insertable ? 'insertable' : 'existing-only',
      'category' in material ? material.category : undefined,
    ].filter(Boolean)
    lines.push(
      `${material.componentName}[${qualifiers.join(',')}]${
        'useFor' in material ? ` use=${material.useFor.join('|')}` : ''
      }${guidance.length ? ` note=${guidance.join(' ')}` : ''}`,
    )
    lines.push(
      ` fields=${Object.entries(writableFields)
        .map(([fieldId, contract]) => `${fieldId}<${fieldContract(fieldId, contract)}>`)
        .join(';')}`,
    )
  }
  return lines.join('\n')
}
