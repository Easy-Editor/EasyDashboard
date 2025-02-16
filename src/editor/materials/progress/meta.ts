import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Progress',
  title: '进度条',
  category: '数据',
  snippets,
  configure,
}

export default meta
