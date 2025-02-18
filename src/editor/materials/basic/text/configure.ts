import type { Configure } from '@easy-editor/core'
import Button from './component'

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: '功能',
      items: [
        {
          type: 'field',
          name: 'text',
          title: '内容',
          setter: 'StringSetter',
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: {
    view: Button,
  },
}

export default configure
