import type { ComponentsMap, NpmInfo } from '@easy-editor/core'
import { materialManager } from './managers'

/**
 * 从 componentsMap 加载远程物料元数据
 */
export const loadRemoteMaterialsFromComponentsMap = async (componentsMap?: ComponentsMap) => {
  if (!componentsMap || componentsMap.length === 0) {
    return
  }

  // 提取所有 ProCode 组件（NpmInfo）
  const remoteMaterials: Array<{ package: string; version?: string; globalName: string }> = []
  const seenPackages = new Set<string>()

  for (const component of componentsMap) {
    if ('package' in component && 'globalName' in component) {
      const npmInfo = component as NpmInfo
      const packageKey = `${npmInfo.package}@${npmInfo.version || 'latest'}`

      if (!seenPackages.has(packageKey) && npmInfo.globalName) {
        seenPackages.add(packageKey)
        remoteMaterials.push({
          package: npmInfo.package,
          version: npmInfo.version || 'latest',
          globalName: npmInfo.globalName,
        })
      }
    }
  }

  if (remoteMaterials.length > 0) {
    try {
      const loaded = await materialManager.loadFullMultiple(remoteMaterials)
      console.log('loadRemoteMaterialsFromComponentsMap', loaded)
    } catch (error) {
      console.error('[EasyEditor] Failed to load remote material metas from componentsMap:', error)
    }
  }
}
