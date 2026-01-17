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
    console.log(`[EasyEditor] Loading ${remoteMaterials.length} remote material metas from componentsMap...`)
    try {
      await materialManager.loadMetaMultiple(remoteMaterials)
      console.log('[EasyEditor] Remote material metas from componentsMap loaded successfully')
    } catch (error) {
      console.error('[EasyEditor] Failed to load remote material metas from componentsMap:', error)
    }
  }
}

/**
 * 自动批量加载所有远程组件代码（后台异步，不阻塞）
 */
export const autoLoadAllRemoteComponents = async () => {
  const packages = materialManager.getLoadedPackages()
  const pendingPackages = packages.filter(p => !p.hasComponent)

  if (pendingPackages.length === 0) {
    return
  }

  console.log(`[EasyEditor] Auto-loading ${pendingPackages.length} remote components...`)

  // 并行加载所有组件
  const results = await Promise.allSettled(pendingPackages.map(p => materialManager.addComponent(p.name)))

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length
  console.log(`[EasyEditor] Auto-load completed: ${succeeded} success, ${failed} failed`)
}
