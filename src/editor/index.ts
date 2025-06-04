import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import { type ProjectSchema, type RootSchema, init, materials, plugins, project, setters } from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import DataSourcePlugin from '@easy-editor/plugin-datasource'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultProjectSchema } from './const'
import { componentMetaMap } from './materials'
import { pluginList } from './plugins'
import { setterMap } from './setters'

import './overrides.css'

plugins.registerPlugins([
  DashboardPlugin({
    group: {
      meta: componentMetaMap.Group,
      initSchema: {
        componentName: 'Group',
        title: '分组',
        isGroup: true,
      },
    },
  }),
  HotkeyPlugin(),
  DataSourcePlugin(),
  ...pluginList,
])
materials.buildComponentMetasMap(Object.values(componentMetaMap))
setters.registerSetter(setterMap)

await init({
  designMode: 'design',
  appHelper: {
    utils: {
      test: 'test',
    },
  },
})

project.onSimulatorReady(simulator => {
  simulator.set('deviceStyle', { viewport: { width: 1920, height: 1080 } })
})

const initProjectSchema = async () => {
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
      project.load(defaultProjectSchema, true)
    }
  } else {
    project.load(defaultProjectSchema, true)
  }
}

initProjectSchema()
