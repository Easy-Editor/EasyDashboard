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
              name: 'title',
              title: '标题',
              setter: 'StringSetter',
              extraProps: {
                getValue(target) {
                  return target.getExtraPropValue('title')
                },
                setValue(target, value) {
                  target.setExtraPropValue('title', value)
                },
              },
            },
            {
              type: 'group',
              title: '基础属性',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: true,
                },
              },
              items: [
                {
                  name: 'rect',
                  title: '位置尺寸',
                  setter: 'RectSetter',
                  extraProps: {
                    getValue(target) {
                      return target.getExtraPropValue('$dashboard.rect')
                    },
                    setValue(target, value) {
                      target.setExtraPropValue('$dashboard.rect', value)
                    },
                  },
                },
                {
                  name: 'text',
                  title: '内容',
                  setter: 'StringSetter',
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
              title: '基础属性',
              setter: 'SubTabSetter',
              items: [
                {
                  type: 'group',
                  key: 'basic',
                  title: '测试1',
                  items: [
                    {
                      name: 'text',
                      title: '内容123',
                      setter: 'StringSetter',
                    },
                  ],
                },
                {
                  type: 'group',
                  key: 'test',
                  title: '测试2',
                  items: [
                    {
                      name: 'text',
                      title: '内容312',
                      setter: 'StringSetter',
                    },
                  ],
                },
              ],
            },
            {
              type: 'group',
              title: '基础属性',
              setter: {
                componentName: 'AccordionSetter',
                props: {
                  orientation: 'horizontal',
                },
              },
              items: [
                {
                  name: 'text',
                  title: '内容',
                  setter: 'StringSetter',
                },
                {
                  name: 'text',
                  title: '内容',
                  setter: 'StringSetter',
                },
              ],
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
