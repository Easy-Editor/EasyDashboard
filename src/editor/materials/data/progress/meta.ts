import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Progress',
  title: 'Progress',
  group: MaterialGroup.DATA,
  snippets,
  configure,
}

export default meta
