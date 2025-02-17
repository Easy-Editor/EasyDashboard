import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'RadarChart',
  title: '雷达图',
  category: '图表',
  snippets,
  configure,
}

export default meta
