import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'RadialChartStacked',
  title: 'Radial Chart Stacked',
  group: MaterialGroup.CHART,
  snippets,
  configure,
}

export default meta
