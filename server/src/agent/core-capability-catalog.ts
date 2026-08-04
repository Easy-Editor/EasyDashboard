import { type SkillReference, createSkillRegistry, createSkillTaskManifest } from './skill-registry.js'

export type DashboardAgentCoreCapability = {
  id: string
  title: string
  description: string
}

export const DASHBOARD_AGENT_CORE_CAPABILITIES: readonly DashboardAgentCoreCapability[] = [
  {
    id: 'reference-understanding',
    title: '附件与参考理解',
    description: '理解用户授权的附件和参考图中的构图、内容、字段、配色与信息密度，但不把图片本身当作大屏内容。',
  },
  {
    id: 'semantic-editing',
    title: '自然语言定位与编辑',
    description: '根据可见标题、区域、当前画面和对话上下文定位目标，内部完成组件与字段映射。',
  },
  {
    id: 'material-composition',
    title: '物料组合与布局',
    description: '使用可编辑物料、Div 语义分组和必要的局部自定义效果完成大屏布局。',
  },
  {
    id: 'interaction-and-motion',
    title: '交互与动效',
    description: '为图表、列表、筛选和时间等常见场景配置可观察、可验证的交互与运行时效果。',
  },
]

export function renderDashboardAgentCoreCapabilities(): string {
  return DASHBOARD_AGENT_CORE_CAPABILITIES.map(
    capability => `${capability.title}(${capability.id})：${capability.description}`,
  ).join('\n')
}

const registry = createSkillRegistry({
  capabilityCatalog: [
    'data-source.configure',
    'spatial.advanced',
    'custom-component.sandbox',
    'project.publish',
    'data.clean.specialized',
  ],
  skills: [
    {
      id: 'data-source-design',
      version: '1.0.0',
      title: '数据源接入',
      description: '接入或调整 API、CSV、Excel、数据库等外部数据源。',
      instructions: ['只修改 Host manifest 允许的字段。', '不伪造真实接口已连通，无法确认时保留清晰占位状态。'],
      capabilities: ['data-source.configure'],
      source: 'platform',
    },
    {
      id: 'gis-3d-design',
      version: '1.1.0',
      title: 'GIS 与三维场景',
      description: '处理明确需要地球、球体、星空空间舞台、GIS 或三维空间表达的低频场景。',
      instructions: [
        '先分流表达方式：二维行政区、国家分布或普通世界地图使用 GeoMap，不要误用 GlobeScene。',
        '中央可旋转地球、星空和大气层主视觉优先使用 GlobeScene，并放入独立的中央地球 Div 分组。',
        'GlobeScene 只承载中央地球舞台；标题、时间、左右 HUD、图表和列表继续使用 Div 与普通可编辑物料。',
        '只有局部特殊空间效果无法由 GeoMap 或 GlobeScene 表达时才使用局部 DashboardScene。',
        '禁止用整屏自定义组件、整屏 DashboardScene 或参考图片背景替代可编辑物料组合。',
        '保持空间数据来源和坐标口径可追溯。',
      ],
      capabilities: ['spatial.advanced'],
      source: 'platform',
    },
    {
      id: 'sandbox-custom-component',
      version: '1.0.0',
      title: '沙箱自定义组件',
      description: '在现有物料与局部 DashboardScene 均无法表达时实现隔离的自定义组件。',
      instructions: ['仅处理明确的局部能力缺口。', '自定义代码必须留在受限沙箱和授权边界内。'],
      capabilities: ['custom-component.sandbox'],
      source: 'platform',
    },
    {
      id: 'dashboard-publishing',
      version: '1.0.0',
      title: '大屏发布',
      description: '处理需要显式授权的预发布检查和发布流程。',
      instructions: ['发布前展示目标环境与版本。', '未经明确授权不得执行发布。'],
      capabilities: ['project.publish'],
      source: 'platform',
    },
    {
      id: 'specialized-data-cleaning',
      version: '1.0.0',
      title: '专用数据清洗',
      description: '处理复杂异常、跨表合并或需要专门规则的数据清洗。',
      instructions: ['保留原始数据和清洗规则的可追溯性。', '不以静默丢弃代替异常处理。'],
      capabilities: ['data.clean.specialized'],
      source: 'platform',
    },
  ],
})

const DATA_SOURCE_TERM_PATTERN = /(?:数据源|接口|API|CSV|Excel|数据库|实时数据)/iu
const DATA_SOURCE_NEGATION_PATTERN =
  /(?:(?:不(?:要|得|必|需|需要|用|应|可|能)|无需|禁止|避免|暂不|先不|尚未|未)(?:[^，,。！？!?；;\n]{0,24})(?:数据源|接口|API|CSV|Excel|数据库|实时数据)|(?:数据源|接口|API|CSV|Excel|数据库|实时数据)(?:[^，,。！？!?；;\n]{0,24})(?:无需|不需要|不要|暂不|先不|尚未|未接入|未连接|禁止))/iu

function requestsDataSourceWork(prompt: string): boolean {
  return prompt
    .split(/[，,。！？!?；;\n]+/u)
    .some(clause => DATA_SOURCE_TERM_PATTERN.test(clause) && !DATA_SOURCE_NEGATION_PATTERN.test(clause))
}

export function selectDashboardAgentSkillManifest(prompt: string) {
  const selected: SkillReference[] = []
  const grantedCapabilities: string[] = []
  const add = (id: string, capability: string): void => {
    selected.push({ id })
    grantedCapabilities.push(capability)
  }

  if (requestsDataSourceWork(prompt)) {
    add('data-source-design', 'data-source.configure')
  }
  if (
    /(?:\bGIS\b|(?:三维|3D)\s*(?:地球|地球仪|球体|地图|场景|空间|GIS)|(?:旋转|自转|立体)?\s*(?:地球|地球仪|球体)|星空(?:粒子|背景|场景)?|空间数据|空间场景|倾斜摄影|点云|全球(?:自然)?资源(?!\s*(?:数据\s*)?(?:排名|排行|列表|表格|清单|统计表))(?:数据)?)/iu.test(
      prompt,
    )
  ) {
    add('gis-3d-design', 'spatial.advanced')
  }
  if (/(?:沙箱.*自定义组件|自定义组件.*沙箱|编写.*自定义组件)/iu.test(prompt)) {
    add('sandbox-custom-component', 'custom-component.sandbox')
  }
  if (/(?:发布|上线|部署到生产)/iu.test(prompt)) add('dashboard-publishing', 'project.publish')
  if (/(?:数据清洗|清洗.*(?:异常|明细|数据)|异常数据.*处理)/iu.test(prompt)) {
    add('specialized-data-cleaning', 'data.clean.specialized')
  }

  return createSkillTaskManifest({ registry, skills: selected, grantedCapabilities })
}
