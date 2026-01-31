import { getPageDataFromLocalStorage, getProjectSchemaFromLocalStorage } from '@/lib/schema'
import { init, materials, plugins, project, setters } from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import DataSourcePlugin from '@easy-editor/plugin-datasource'
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
  // 从已加载的 schema 中读取分辨率
  const projectSchema = getProjectSchemaFromLocalStorage()
  const firstPage = projectSchema?.componentsTree?.[0] as any
  const rect = firstPage?.$dashboard?.rect
  const viewport = {
    width: rect?.width ?? 1920,
    height: rect?.height ?? 1080,
  }
  simulator.set('deviceStyle', { viewport })
})

project.onRendererReady(() => {
  project.documents[0]?.rootNode?.select()
})

const initProjectSchema = async () => {
  const projectSchema = getProjectSchemaFromLocalStorage()

  if (projectSchema && projectSchema.componentsTree.length > 0) {
    const firstPageFileName = projectSchema.componentsTree[0].fileName

    // 尝试从页面级存储获取第一个页面的数据
    const firstPageData = firstPageFileName ? getPageDataFromLocalStorage(firstPageFileName) : null

    // 加载项目（只会创建第一个页面的 Document）
    project.load(projectSchema, true)

    // 只加载第一个页面的远程物料
    if (firstPageData?.componentsMap) {
      // 新格式：从页面级存储加载
      loadRemoteMaterialsFromComponentsMap(firstPageData.componentsMap)
    } else if (projectSchema.componentsMap) {
      // 旧格式兼容：从项目级 componentsMap 加载
      loadRemoteMaterialsFromComponentsMap(projectSchema.componentsMap)
    }
  } else {
    project.load(defaultProjectSchema, true)
  }
}

initProjectSchema()

// 异步加载远程资源
loadAllRemoteResources().catch(error => {
  console.error('[Remote] Failed to load resources:', error)
})
