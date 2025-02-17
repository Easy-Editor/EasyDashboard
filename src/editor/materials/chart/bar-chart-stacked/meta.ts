import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'BarChartStacked',
  title: 'Bar Chart Stacked',
  group: MaterialGroup.CHART,
  snippets,
  configure,
}

export default meta
