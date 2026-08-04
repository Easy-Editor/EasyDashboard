import type { Configure, Node } from '@easy-editor/core'
import { updateNodeRect } from '@easy-editor/plugin-dashboard'
import Div from './component'

const propAgentCapability = (name: string, valueSchema: Record<string, unknown>) => ({
  access: 'read-write',
  fieldId: `div.${name}`,
  readPath: ['props', name],
  writeTargets: [{ path: ['props', name] }],
  unsetTargets: [{ path: ['props', name] }],
  valueSchema,
  verifyPaths: [['props', name]],
})

const titleAgentCapability = {
  access: 'read-write',
  fieldId: 'shared.title',
  readPath: ['extra', 'title'],
  writeTargets: [{ path: ['extra', 'title'] }],
  unsetTargets: [{ path: ['extra', 'title'] }],
  valueSchema: { type: 'string' },
  verifyPaths: [['extra', 'title']],
}

const rectAgentCapability = {
  access: 'read-write',
  fieldId: 'shared.rect',
  readPath: ['extra', '$dashboard', 'rect'],
  writeTargets: [{ path: ['extra', '$dashboard', 'rect'] }],
  unsetTargets: [{ path: ['extra', '$dashboard', 'rect'] }],
  valueSchema: {
    type: 'object',
    required: ['x', 'y', 'width', 'height'],
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number', minimum: 0 },
      height: { type: 'number', minimum: 0 },
    },
  },
  verifyPaths: [['extra', '$dashboard', 'rect']],
}

const visibilityAgentCapability = {
  access: 'read-write',
  fieldId: 'shared.visibility',
  readPath: ['extra', 'condition'],
  writeTargets: [{ path: ['extra', 'condition'] }],
  unsetTargets: [{ path: ['extra', 'condition'] }],
  valueSchema: { type: 'boolean' },
  verifyPaths: [['extra', 'condition']],
}

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
              extraProps: { agent: { expose: false }, label: false } as any,
            },
            {
              name: 'title',
              title: '标题',
              setter: 'StringSetter',
              extraProps: {
                agent: titleAgentCapability,
                getValue(target: any) {
                  return target.getExtraPropValue('title')
                },
                setValue(target: any, value: string) {
                  target.setExtraPropValue('title', value)
                },
              } as any,
            },
            {
              type: 'group',
              title: '容器样式',
              setter: {
                componentName: 'CollapseSetter',
                props: { icon: false },
              },
              items: [
                {
                  name: 'background',
                  title: '背景',
                  setter: 'StringSetter',
                  extraProps: { defaultValue: 'transparent' },
                },
                {
                  name: 'borderColor',
                  title: '边框颜色',
                  setter: 'ColorSetter',
                  extraProps: { defaultValue: 'transparent' },
                },
                {
                  name: 'borderWidth',
                  title: '边框宽度',
                  setter: 'NumberSetter',
                  extraProps: { defaultValue: 0 },
                },
                {
                  name: 'borderRadius',
                  title: '圆角',
                  setter: 'NumberSetter',
                  extraProps: { defaultValue: 0 },
                },
                {
                  name: 'opacity',
                  title: '透明度',
                  setter: 'NumberSetter',
                  extraProps: { defaultValue: 100 },
                },
                {
                  name: 'panelShape',
                  title: '面板形状',
                  setter: {
                    componentName: 'SelectSetter',
                    props: {
                      options: [
                        { label: '矩形', value: 'rect' },
                        { label: '左侧 HUD 翼板', value: 'hud-left' },
                        { label: '右侧 HUD 翼板', value: 'hud-right' },
                      ],
                    },
                  },
                  extraProps: {
                    agent: propAgentCapability('panelShape', {
                      type: 'string',
                      enum: ['rect', 'hud-left', 'hud-right'],
                    }),
                    defaultValue: 'rect',
                  } as any,
                },
                {
                  name: 'panelInset',
                  title: '翼板斜角（像素）',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('panelInset', {
                      type: 'number',
                      minimum: 0,
                      maximum: 96,
                    }),
                    defaultValue: 24,
                  } as any,
                },
                {
                  name: 'visualPreset',
                  title: '视觉预设',
                  setter: {
                    componentName: 'SelectSetter',
                    props: {
                      options: [
                        { label: '无', value: 'none' },
                        { label: 'HUD 暗色面板', value: 'hud-panel' },
                        { label: '指标轴线与圆节点', value: 'metric-axis' },
                        { label: '四角短线框', value: 'corner-frame' },
                      ],
                    },
                  },
                  extraProps: {
                    agent: propAgentCapability('visualPreset', {
                      type: 'string',
                      enum: ['none', 'hud-panel', 'metric-axis', 'corner-frame'],
                    }),
                    defaultValue: 'none',
                  } as any,
                },
                {
                  name: 'enterAnimation',
                  title: '入场动画',
                  setter: {
                    componentName: 'SelectSetter',
                    props: {
                      options: [
                        { label: '无', value: 'none' },
                        { label: '淡入', value: 'fade' },
                        { label: '从左进入', value: 'slide-left' },
                        { label: '从右进入', value: 'slide-right' },
                        { label: '上升淡入', value: 'rise' },
                      ],
                    },
                  },
                  extraProps: {
                    agent: propAgentCapability('enterAnimation', {
                      type: 'string',
                      enum: ['none', 'fade', 'slide-left', 'slide-right', 'rise'],
                    }),
                    defaultValue: 'none',
                  } as any,
                },
                {
                  name: 'enterDuration',
                  title: '入场时长（毫秒）',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('enterDuration', {
                      type: 'number',
                      minimum: 100,
                      maximum: 10_000,
                    }),
                    defaultValue: 700,
                  } as any,
                },
                {
                  name: 'enterDelay',
                  title: '入场延迟（毫秒）',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('enterDelay', {
                      type: 'number',
                      minimum: 0,
                      maximum: 30_000,
                    }),
                    defaultValue: 0,
                  } as any,
                },
                {
                  name: 'overflow',
                  title: '溢出',
                  setter: {
                    componentName: 'SelectSetter',
                    props: {
                      options: [
                        { label: '可见', value: 'visible' },
                        { label: '隐藏', value: 'hidden' },
                        { label: '自动', value: 'auto' },
                      ],
                    },
                  },
                  extraProps: { defaultValue: 'visible' },
                },
                {
                  name: 'shadowColor',
                  title: '阴影颜色',
                  setter: 'ColorSetter',
                  extraProps: { defaultValue: 'rgba(0, 0, 0, 0.18)' },
                },
                {
                  name: 'shadowBlur',
                  title: '阴影模糊',
                  setter: 'NumberSetter',
                  extraProps: { defaultValue: 0 },
                },
                {
                  name: 'shadowOffsetY',
                  title: '阴影垂直偏移',
                  setter: 'NumberSetter',
                  extraProps: { defaultValue: 0 },
                },
              ],
            },
            {
              type: 'group',
              title: '基础属性',
              setter: {
                componentName: 'CollapseSetter',
                props: { icon: false },
              },
              items: [
                {
                  name: 'rect',
                  title: '位置尺寸',
                  setter: 'RectSetter',
                  extraProps: {
                    agent: rectAgentCapability,
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
                  } as any,
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
              extraProps: { agent: { expose: false }, label: false } as any,
            },
            {
              name: 'condition',
              title: '显隐',
              setter: 'SwitchSetter',
              extraProps: {
                agent: visibilityAgentCapability,
                supportVariable: true,
                getValue(target: any) {
                  return target.getNode().getExtraPropValue('condition')
                },
                setValue(target: any, value: boolean) {
                  target.getNode().setExtraProp('condition', value)
                },
              } as any,
            },
          ],
        },
      ],
    },
  ],
  component: { isContainer: true },
  supports: {},
  advanced: { view: Div },
}

export default configure
