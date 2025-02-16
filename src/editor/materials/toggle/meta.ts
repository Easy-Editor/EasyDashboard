import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Toggle',
  title: 'Toggle',
  category: '通用',
  snippets,
  configure,
}

export default meta
