import type { Configure, Node } from '@easy-editor/core'
import { updateNodeRect } from '@easy-editor/plugin-dashboard'
import Group from './component'

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
          title: '配置',
          items: [
            {
              name: 'nodeInfo',
              title: '节点信息',
              setter: 'NodeInfoSetter',
              extraProps: {
                label: false,
              },
            },
            {
              name: 'title',
              title: '标题',
              setter: 'StringSetter',
              extraProps: {
                getValue(target: any) {
                  return target.getExtraPropValue('title')
                },
                setValue(target: any, value: string) {
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
                    getValue(target: any) {
                      const node = target.getNode() as Node
                      return node.getDashboardRect()
                    },
                    setValue(target: any, value: { x?: number; y?: number }) {
                      const node = target.getNode() as Node
                      const currentRect = node.getDashboardRect()
                      const x = value.x ?? currentRect.x
                      const y = value.y ?? currentRect.y
                      updateNodeRect(node, { x, y })
                    },
                  },
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
              name: 'nodeInfo',
              title: '节点信息',
              setter: 'NodeInfoSetter',
              extraProps: {
                label: false,
              },
            },
            {
              title: '显隐',
              setter: 'SwitchSetter',
              extraProps: {
                supportVariable: true,
                getValue(target) {
                  return target.getNode().getExtraPropValue('condition')
                },
                setValue(target, value: boolean) {
                  target.getNode().setExtraProp('condition', value)
                },
              },
            },
          ],
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: {
    view: Group,
  },
}

export default configure
