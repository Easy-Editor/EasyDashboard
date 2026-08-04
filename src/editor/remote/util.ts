import type { ComponentsMap, NpmInfo } from '@easy-editor/core'
import { materialManager } from './managers'

/**
 * 从 componentsMap 加载远程物料元数据
 */
export const loadRemoteMaterialsFromComponentsMap = async (componentsMap?: ComponentsMap) => {
  if (!componentsMap || componentsMap.length === 0) {
    materialManager.activatePackages([])
    return
  }

  // 提取所有 ProCode 组件（NpmInfo）
  const remoteMaterials: Array<{ package: string; version?: string; globalName: string; componentName?: string }> = []
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
          componentName: npmInfo.componentName,
        })
      }
    }
  }

  materialManager.activatePackages(remoteMaterials)

  if (remoteMaterials.length > 0) {
    const loaded = await materialManager.loadMaterialMultiple(remoteMaterials)
    const failures = loaded.results.flatMap((result, index) => {
      if (result.status === 'fulfilled') return []

      const config = remoteMaterials[index]
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      return [`${config.package}@${config.version ?? 'latest'}: ${reason}`]
    })

    if (failures.length > 0) {
      throw new Error(`Required remote material load failed: ${failures.join('; ')}`)
    }

    console.log(
      `[EasyEditor] Remote materials loaded: ${loaded.succeeded}/${loaded.total}; components=${Object.keys(
        materialManager.remoteComponentsMap,
      )
        .sort()
        .join(',')}`,
    )
  }
}
