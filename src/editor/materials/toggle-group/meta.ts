import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'ToggleGroup',
  title: 'ToggleGroup',
  category: '通用',
  snippets,
  configure,
}

export default meta
