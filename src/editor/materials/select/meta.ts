import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Select',
  title: '选择器',
  category: '表单',
  snippets,
  configure,
}

export default meta
