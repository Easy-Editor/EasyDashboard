import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Carousel',
  title: '轮播图',
  category: '展示',
  snippets,
  configure,
}

export default meta
