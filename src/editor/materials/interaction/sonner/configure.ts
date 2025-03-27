import type { Configure } from '@easy-editor/core'
import { generalAdvancedConfigure, generalBasicConfigure } from '../../configure'
import Sonner from './component'

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: '功能',
      setter: 'TabSetter',
      items: [
        {
          type: 'group',
          key: 'basic',
          title: '基本',
          items: [...generalBasicConfigure],
        },
        {
          type: 'group',
          key: 'advanced',
          title: '高级',
          items: [...generalAdvancedConfigure],
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: {
    view: Sonner,
  },
}

export default configure
