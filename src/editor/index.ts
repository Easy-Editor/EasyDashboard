import { getProjectSchemaFromLocalStorage } from '@/lib/schema'
import { type ProjectSchema, init, materials, plugins, project, setters } from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import DataSourcePlugin from '@easy-editor/plugin-datasource'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultProjectSchema } from './const'
import { componentMetaMap } from './materials'
import { pluginList } from './plugins'
import { loadAllRemoteResources } from './remote'
import { loadRemoteMaterialsFromComponentsMap } from './remote/util'
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
  const projectSchema = getProjectSchemaFromLocalStorage() as ProjectSchema
  if (projectSchema) {
    project.load(projectSchema, true)
    // 异步加载远程组件
    loadRemoteMaterialsFromComponentsMap(projectSchema.componentsMap)
  } else {
    project.load(defaultProjectSchema, true)
  }
}

initProjectSchema()

// 异步加载远程资源
loadAllRemoteResources().catch(error => {
  console.error('[Remote] Failed to load resources:', error)
})
