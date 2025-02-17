import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Combobox',
  title: 'Combobox',
  group: MaterialGroup.INTERACTION,
  snippets,
  configure,
}

export default meta
