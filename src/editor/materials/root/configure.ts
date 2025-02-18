import type { Configure } from '@easy-editor/core'
import Root from './component'

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: '功能',
      items: [
        {
          name: 'backgroundColor',
          title: '背景颜色',
          setter: 'StringSetter',
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: {
    view: Root,
  },
}

export default configure
