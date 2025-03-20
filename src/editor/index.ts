import {
  type Component,
  type ComponentMetaManager,
  type ComponentMetadata,
  type Designer,
  type Project,
  type Setter,
  type SetterManager,
  type Simulator,
  createEasyEditor,
} from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultRootSchema } from './const'
import { formatMapFromESModule } from './utils'

const plugins = (await import('./plugins')).default
const setterMap = await import('./setters')
const componentMap = await import('./materials/component')
const componentMetaMap = await import('./materials/meta')

export const components = formatMapFromESModule<Component>(componentMap)

export const editor = createEasyEditor({
  lifeCycles: {
    init: () => {
      console.log('init')
    },
    destroy: () => {
      console.log('destroy')
    },
  },
  plugins: [DashboardPlugin(), HotkeyPlugin(), ...plugins],
  setters: formatMapFromESModule<Setter>(setterMap),
  components: formatMapFromESModule<Component>(componentMap),
  componentMetas: formatMapFromESModule<ComponentMetadata>(componentMetaMap),
  hotkeys: [
    {
      combos: ['ctrl+a'],
      callback: e => {
        e.preventDefault()
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

  // project.open(defaultRootSchema)
  project.load(
    {
      componentsTree: [
        {
          ...defaultRootSchema,
          fileName: 'home',
          fileDesc: '首页',
          children: [
            {
              componentName: 'Button',
              props: {
                type: 'primary',
                content: 'Button in Root',
              },
              $dashboard: {
                rect: {
                  x: 600,
                  y: 100,
                  width: 180,
                  height: 150,
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
                  x: 1000,
                  y: 100,
                  width: 370,
                  height: 60,
                },
              },
            },
          ],
        },
      ],
      version: '1.0.0',
    },
    true,
  )

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
