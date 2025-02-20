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
                  icon: false,
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
              ],
            },
            {
              type: 'group',
              setter: 'SubTabSetter',
              items: [
                {
                  type: 'group',
                  key: 'basic',
                  title: '全局',
                  items: [
                    {
                      name: 'textDirection',
                      title: '文字方向',
                      setter: {
                        componentName: 'RadioSetter',
                        props: {
                          // orientation: '',
                          options: [
                            {
                              label: '横排',
                              value: 'horizontal',
                            },
                            {
                              label: '竖排',
                              value: 'vertical',
                            },
                          ],
                        },
                      },
                    },
                    {
                      name: 'variant',
                      title: '按钮样式',
                      setter: {
                        componentName: 'SelectSetter',
                        props: {
                          options: [
                            {
                              label: '默认',
                              value: 'default',
                            },
                            {
                              label: '次要',
                              value: 'secondary',
                            },
                            {
                              label: '危险',
                              value: 'destructive',
                            },
                            {
                              label: '线框',
                              value: 'outline',
                            },
                            {
                              label: '幽灵',
                              value: 'ghost',
                            },
                            {
                              label: '链接',
                              value: 'link',
                            },
                          ],
                        },
                      },
                    },
                    {
                      name: 'loading',
                      title: '加载',
                      setter: 'SwitchSetter',
                    },
                    {
                      name: 'text',
                      title: '内容',
                      setter: 'StringSetter',
                    },
                    {
                      name: 'testNum',
                      title: '内容',
                      setter: 'NumberSetter',
                    },
                  ],
                },
                {
                  type: 'group',
                  key: 'test',
                  title: '样式',
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
