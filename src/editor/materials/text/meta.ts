import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Text',
  title: '文本',
  category: '通用',
  snippets,
  configure,
}

export default meta
