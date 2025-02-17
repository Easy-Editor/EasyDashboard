import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'RadialChart',
  title: '径向图',
  category: '图表',
  snippets,
  configure,
}

export default meta
