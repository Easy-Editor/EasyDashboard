import { getProjectSchemaFromLocalStorage } from '@/lib/schema'
import { init, materials, plugins, project } from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import DataSourcePlugin from '@easy-editor/plugin-datasource'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultProjectSchema } from './const'
import { componentMetaMap } from './materials'
import { pluginList } from './plugins'
import { loadAllRemoteResources } from './remote'

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
// setters.registerSetter(setterMap)

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
  const projectSchema = getProjectSchemaFromLocalStorage()
  if (projectSchema) {
    project.load(projectSchema, true)
  } else {
    project.load(defaultProjectSchema, true)
  }
}

initProjectSchema()

// 异步加载远程资源
loadAllRemoteResources()
  .then(result => {
    console.log('[Remote] Resources loaded:', result)
  })
  .catch(error => {
    console.error('[Remote] Failed to load resources:', error)
  })
