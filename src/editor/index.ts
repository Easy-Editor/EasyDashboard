import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import {
  type ComponentMetaManager,
  type Designer,
  type Project,
  type ProjectSchema,
  type RootSchema,
  type SetterManager,
  type Simulator,
  createEasyEditor,
} from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultRootSchema } from './const'
import { componentMetas, components } from './materials'
import { plugins } from './plugins'
import { setters } from './setters'

export const editor = createEasyEditor({
  lifeCycles: {
    init: () => {
      console.log('init')
    },
    destroy: () => {
      console.log('destroy')
    },
  },
  components,
  componentMetas,
  plugins: [DashboardPlugin(), HotkeyPlugin(), ...plugins],
  setters,
  hotkeys: [
    {
      combos: ['ctrl+a'],
      callback: e => {
        console.log('ctrl+a', e)
      },
    },
  ],
})
console.log('🚀 ~ easyEditor:', editor)

export const initProject = async () => {
  const [designer, project, simulator] = await Promise.all([
    editor.onceGot<Designer>('designer'),
    editor.onceGot<Project>('project'),
    editor.onceGot<Simulator>('simulator'),
  ])

  // 设置模拟器样式
  simulator.set('deviceStyle', { viewport: { width: 1920, height: 1080 } })

  const defaultSchema = {
    componentsTree: [
      {
        ...defaultRootSchema,
        fileName: 'index',
        fileDesc: '首页',
        children: [
          {
            componentName: 'Image',
            condition: {
              type: 'JSExpression',
              value: 'this.state.isShow',
            },
            $dashboard: {
              rect: {
                x: 600,
                y: 480,
                width: 740,
                height: 120,
              },
            },
          },
          {
            componentName: 'Button',
            props: {
              content: 'Button in Root',
              __events: {
                eventDataList: [
                  {
                    type: 'componentEvent',
                    name: 'onClick',
                    relatedEventName: 'toggleState',
                  },
                ],
                eventList: [
                  {
                    name: 'onClick',
                    description: '鼠标点击',
                    disabled: true,
                  },
                ],
              },
              onClick: {
                type: 'JSFunction',
                value:
                  'function(){return this.toggleState.apply(this,Array.prototype.slice.call(arguments).concat([])) }',
              },
            },
            $dashboard: {
              rect: {
                x: 100,
                y: 100,
                width: 200,
                height: 50,
              },
            },
          },
          {
            componentName: 'Button',
            props: {
              content: 'Next Page',
              __events: {
                eventDataList: [
                  {
                    type: 'builtin',
                    name: 'onClick',
                    relatedEventName: 'utils.navigate',
                    paramStr: '"test"',
                  },
                ],
                eventList: [
                  {
                    name: 'onClick',
                    description: '鼠标点击',
                    disabled: true,
                  },
                ],
              },
              onClick: {
                type: 'JSFunction',
                value:
                  'function(){return this.utils.navigate.apply(this,Array.prototype.slice.call(arguments).concat(["test"])) }',
              },
            },
            $dashboard: {
              rect: {
                x: 1700,
                y: 1000,
                width: 200,
                height: 50,
              },
            },
          },
        ],
      },
      {
        ...defaultRootSchema,
        fileName: 'test',
        fileDesc: '测试',
        children: [
          {
            componentName: 'Image',
            $dashboard: {
              rect: {
                x: 0,
                y: 0,
                width: 740,
                height: 120,
              },
            },
          },

          {
            componentName: 'Button',
            props: {
              content: 'Prev Page',
              __events: {
                eventDataList: [
                  {
                    type: 'builtin',
                    name: 'onClick',
                    relatedEventName: 'utils.navigate',
                    paramStr: '"test"',
                  },
                ],
                eventList: [
                  {
                    name: 'onClick',
                    description: '鼠标点击',
                    disabled: true,
                  },
                ],
              },
              onClick: {
                type: 'JSFunction',
                value:
                  'function(){return this.utils.navigate.apply(this,Array.prototype.slice.call(arguments).concat(["index"])) }',
              },
            },
            $dashboard: {
              rect: {
                x: 80,
                y: 1000,
                width: 200,
                height: 50,
              },
            },
          },
        ],
      },
    ],
    version: '1.0.0',
  }

  // 从本地获取
  const pageInfo = getPageInfoFromLocalStorage()
  if (pageInfo && pageInfo.length > 0) {
    let isLoad = true
    const projectSchema = {
      componentsTree: pageInfo.map(item => {
        const schema = getPageSchemaFromLocalStorage(item.path)
        if (!schema) {
          isLoad = false
        }
        return (schema as ProjectSchema<RootSchema>).componentsTree[0]
      }),
      version: '1.0.0',
    }
    if (isLoad) {
      project.load(projectSchema, true)
    } else {
      project.load(defaultSchema, true)
    }
  } else {
    project.load(defaultSchema, true)
  }

  return { designer, project, simulator }
}

// 导出初始化后的实例
export const { designer, project, simulator } = await initProject()

console.log('--------------------------------')
console.log('designer', designer)
console.log('project', project)
console.log('simulator', simulator)

const setterManager = await editor.onceGot<SetterManager>('setterManager')
const componentMetaManager = await editor.onceGot<ComponentMetaManager>('componentMetaManager')

console.log('--------------------------------')
console.log('setters', setterManager.settersMap)
console.log('components', simulator.components)
console.log('componentMetas', componentMetaManager.componentMetasMap)

console.log('--------------------------------')
// simulator.setupEvents()
// renderer.mount(simulator)
