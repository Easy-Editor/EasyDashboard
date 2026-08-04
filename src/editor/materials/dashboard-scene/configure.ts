import type { Configure, Node } from '@easy-editor/core'
import { updateNodeRect } from '@easy-editor/plugin-dashboard'
import DashboardScene from './component'
import { defaultLocalizedDashboardSceneSpec } from './spec'

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
              extraProps: { label: false },
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
              name: 'spec',
              title: '大屏场景规范',
              setter: {
                componentName: 'JsonSetter',
                defaultValue: defaultLocalizedDashboardSceneSpec,
              },
            },
            {
              name: 'widgetData',
              title: '主物料数据覆盖',
              setter: {
                componentName: 'JsonSetter',
                defaultValue: {},
              },
            },
            {
              type: 'group',
              title: '基础属性',
              setter: { componentName: 'CollapseSetter', props: { icon: false } },
              items: [
                {
                  name: 'rect',
                  title: '位置尺寸',
                  setter: 'RectSetter',
                  extraProps: {
                    getValue(target: any) {
                      return (target.getNode() as Node).getDashboardRect()
                    },
                    setValue(target: any, value: { x?: number; y?: number; width?: number; height?: number }) {
                      const node = target.getNode() as Node
                      const current = node.getDashboardRect()
                      updateNodeRect(node, {
                        x: value.x ?? current.x,
                        y: value.y ?? current.y,
                      })
                      node.updateDashboardRect({
                        width: value.width ?? current.width,
                        height: value.height ?? current.height,
                      })
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
              extraProps: { label: false },
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
  advanced: { view: DashboardScene },
}

export default configure
