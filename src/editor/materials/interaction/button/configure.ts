import type { Configure } from '@easy-editor/core'
import Button from './component'

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
          items: [
            {
              name: 'id',
              title: 'ID',
              setter: 'NodeIdSetter',
              extraProps: {
                label: false,
              },
            },
            {
              name: 'text',
              title: '内容',
              setter: 'StringSetter',
            },
          ],
        },
        {
          type: 'group',
          key: 'advanced',
          title: '高级',
          items: [
            {
              name: 'size',
              title: '尺寸',
              setter: 'StringSetter',
            },
          ],
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
