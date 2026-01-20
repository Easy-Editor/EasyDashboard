/**
 * Material Manager
 * 物料管理器
 */

import { type Component, type ComponentMetadata, MaterialSource, materials } from '@easy-editor/core'
import { action, computed, observable, runInAction } from 'mobx'
import { type LoadedMaterial, materialLoader } from '../loaders'

/** 远程物料配置 */
export interface RemoteMaterialConfig {
  /** 包名 */
  package: string
  /** 版本 */
  version?: string
  /** UMD 全局变量名 */
  globalName: string
  /** 是否启用 */
  enabled?: boolean
}

/** 缓存的物料包信息 */
interface CachedMaterialPackage {
  version: string
  globalName: string
  meta: ComponentMetadata
  component?: Component
  hasComponent: boolean
}

/**
 * 远程物料管理器
 */
class MaterialManagerClass {
  /** 已加载的远程物料包 */
  @observable.shallow private accessor remoteMaterialPackages = new Map<string, CachedMaterialPackage>()

  /** 是否正在加载 */
  @observable accessor isLoading = false

  /**
   * 获取已加载的远程物料数量
   */
  @computed
  get loadedCount(): number {
    return this.remoteMaterialPackages.size
  }

  /**
   * 获取已加载的远程组件映射（versionedComponentName -> Component）
   * 注意: componentName 已经是版本化的格式 (如 "AreaChart@1.0.0")
   */
  @computed
  get remoteComponentsMap(): Record<string, Component> {
    const componentsMap: Record<string, Component> = {}

    for (const [_, data] of this.remoteMaterialPackages.entries()) {
      const { component, meta } = data

      // 使用 meta 中的 componentName(应该已经是版本化的)
      const componentName = meta?.componentName

      if (componentName && component) {
        componentsMap[componentName] = component
      }
    }

    return componentsMap
  }

  /**
   * 加载远程物料元数据并注册到编辑器
   */
  @action
  async loadMeta(config: RemoteMaterialConfig): Promise<void> {
    const { package: packageName, version = 'latest', globalName, enabled = true } = config

    if (!enabled) {
      return
    }

    try {
      // 1. 从 CDN 加载元数据
      const meta = await materialLoader.loadMeta({
        package: packageName,
        version,
        globalName,
      })

      // 2. 使用版本化的 componentName 注册到物料系统
      const versionedComponentName = `${meta.componentName}@${version}`
      materials.buildComponentMetasMap([{ ...meta, componentName: versionedComponentName }])

      // 3. 缓存（使用版本化的 key 和 componentName）
      const cacheKey = `${packageName}@${version}`
      runInAction(() => {
        this.remoteMaterialPackages.set(cacheKey, {
          version,
          globalName,
          meta: { ...meta, componentName: versionedComponentName },
          hasComponent: false,
        })
      })

      console.log(`[MaterialManager] Meta registered: ${packageName}@${version}`)
    } catch (error) {
      console.error(`[MaterialManager] Failed to load meta: ${packageName}@${version}`, error)
      throw error
    }
  }

  /**
   * 批量加载远程物料元数据
   */
  @action
  async loadMetaMultiple(configs: RemoteMaterialConfig[]): Promise<{
    total: number
    succeeded: number
    failed: number
  }> {
    this.isLoading = true

    try {
      const results = await Promise.allSettled(configs.map(config => this.loadMeta(config)))

      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const failed = results.filter(r => r.status === 'rejected').length

      console.log(`[MaterialManager] Batch meta load: ${succeeded} success, ${failed} failed`)

      return {
        total: configs.length,
        succeeded,
        failed,
      }
    } finally {
      this.isLoading = false
    }
  }

  /**
   * 加载完整物料（元数据 + 组件）
   */
  @action
  async loadFull(config: RemoteMaterialConfig): Promise<LoadedMaterial> {
    const { package: packageName, version = 'latest', globalName, enabled = true } = config

    if (!enabled) {
      throw new Error(`Material ${packageName} is disabled`)
    }

    try {
      // 1. 从 CDN 加载完整物料
      const loaded = await materialLoader.loadMaterial({
        package: packageName,
        version,
        globalName,
      })

      // 2. 使用 runInAction 确保 MobX 响应式正确触发
      runInAction(() => {
        // 使用版本化的 componentName 注册到物料系统
        const versionedComponentName = `${loaded.meta.componentName}@${version}`

        materials.buildComponentMetasMap([{ ...loaded.meta, componentName: versionedComponentName }])

        // 注册组件时使用版本化的 componentName
        materials.createComponentMeta(
          { ...loaded.meta, componentName: versionedComponentName },
          {
            component: loaded.component,
            source: MaterialSource.REMOTE,
          },
        )

        // 强制刷新 componentMetasMap
        materials.refreshComponentMetasMap()

        // 缓存（使用版本化的 key 和 componentName）
        const cacheKey = `${packageName}@${version}`
        this.remoteMaterialPackages.set(cacheKey, {
          version,
          globalName,
          meta: { ...loaded.meta, componentName: versionedComponentName },
          component: loaded.component,
          hasComponent: true,
        })
      })

      console.log(`[MaterialManager] Full material registered: ${packageName}@${version}`)
      console.log('[MaterialManager] componentsMap:', materials.componentsMap)
      return loaded
    } catch (error) {
      console.error(`[MaterialManager] Failed to load full material: ${packageName}@${version}`, error)
      throw error
    }
  }

  /**
   * 为已加载元数据的物料添加组件代码
   * @param packageName 包名
   * @param version 版本号（可选，如果不提供则尝试查找已加载的版本）
   */
  @action
  async addComponent(packageName: string, version?: string): Promise<void> {
    // 如果提供了版本，使用版本化的 key
    const cacheKey = version ? `${packageName}@${version}` : packageName

    // 尝试使用版本化的 key 查找
    let cached = this.remoteMaterialPackages.get(cacheKey)

    // 如果没找到且没有提供版本，尝试查找任意版本
    if (!cached && !version) {
      // 查找所有匹配的包名
      for (const [key, value] of this.remoteMaterialPackages.entries()) {
        if (key.startsWith(`${packageName}@`)) {
          cached = value
          break
        }
      }
    }

    if (!cached) {
      throw new Error(`Material ${packageName} not found in cache`)
    }

    if (cached.hasComponent) {
      return // 已加载组件
    }

    try {
      const component = await materialLoader.addComponent({
        package: packageName,
        version: cached.version,
        globalName: cached.globalName,
      })

      // 使用 runInAction 确保 MobX 响应式正确触发
      runInAction(() => {
        // 使用缓存中的 componentName(应该已经是版本化的)
        // 如果 cached.meta.componentName 已经包含版本号,直接使用
        // 否则,添加版本号
        const finalComponentName = cached.meta.componentName.includes('@')
          ? cached.meta.componentName
          : `${cached.meta.componentName}@${cached.version}`

        materials.createComponentMeta(
          { ...cached.meta, componentName: finalComponentName },
          {
            component,
            source: MaterialSource.REMOTE,
          },
        )

        // 强制刷新 componentMetasMap
        materials.refreshComponentMetasMap()

        // 更新缓存（使用版本化的 key 和 componentName）
        const finalCacheKey = `${packageName}@${cached.version}`
        this.remoteMaterialPackages.set(finalCacheKey, {
          ...cached,
          meta: { ...cached.meta, componentName: finalComponentName },
          component,
          hasComponent: true,
        })
      })

      console.log('[MaterialManager] componentsMap after registration:', materials.componentsMap)

      console.log(`[MaterialManager] Component registered to materials: ${packageName}@${cached.version}`)
    } catch (error) {
      console.error(`[MaterialManager] Failed to add component: ${packageName}`, error)
      throw error
    }
  }

  /**
   * 加载指定版本的组件（用于版本更新）
   * @param packageName 包名
   * @param version 目标版本
   */
  @action
  async loadComponentVersion(packageName: string, version: string): Promise<void> {
    const cacheKey = `${packageName}@${version}`
    const cached = this.remoteMaterialPackages.get(cacheKey)

    if (cached?.hasComponent) {
      return // 已加载
    }

    try {
      // 加载完整物料（元数据 + 组件）
      const loaded = await materialLoader.loadMaterial({
        package: packageName,
        version,
        globalName: cached?.globalName || '', // 如果缓存中没有，materialLoader 会自动解析
      })

      // 使用 runInAction 确保 MobX 响应式正确触发
      runInAction(() => {
        // 注册组件时使用版本化的 key
        const versionedComponentName = `${loaded.meta.componentName}@${version}`
        materials.createComponentMeta(
          { ...loaded.meta, componentName: versionedComponentName },
          {
            component: loaded.component,
            source: MaterialSource.REMOTE,
          },
        )

        // 强制刷新 componentMetasMap
        materials.refreshComponentMetasMap()

        // 缓存
        this.remoteMaterialPackages.set(cacheKey, {
          version,
          globalName: loaded.meta.npm?.globalName || '',
          meta: loaded.meta,
          component: loaded.component,
          hasComponent: true,
        })
      })

      console.log(`[MaterialManager] Component version loaded: ${packageName}@${version}`)
    } catch (error) {
      console.error(`[MaterialManager] Failed to load component version: ${packageName}@${version}`, error)
      throw error
    }
  }

  /**
   * 批量加载完整物料（元数据 + 组件）
   */
  @action
  async loadMaterialMultiple(configs: RemoteMaterialConfig[]): Promise<{
    total: number
    succeeded: number
    failed: number
    results: PromiseSettledResult<LoadedMaterial>[]
  }> {
    const results = await Promise.allSettled(configs.map(config => this.loadFull(config)))

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    console.log(`[MaterialManager] Batch full load: ${succeeded} success, ${failed} failed`)

    return {
      total: configs.length,
      succeeded,
      failed,
      results,
    }
  }

  /**
   * 获取已加载的远程物料包列表
   */
  getLoadedPackages(): Array<{
    packageName: string // 包名(如 @easy-materials/dashboard)
    version: string // 版本号
    componentName: string // 组件名(已版本化,如 AreaChart@1.0.0)
    hasComponent: boolean
  }> {
    return Array.from(this.remoteMaterialPackages.entries()).map(([cacheKey, data]) => {
      // cacheKey 格式: @easy-materials/dashboard@1.0.0
      // 需要提取 packageName (去掉最后的 @version)
      const lastAtIndex = cacheKey.lastIndexOf('@')
      const packageName = lastAtIndex !== -1 ? cacheKey.substring(0, lastAtIndex) : cacheKey

      return {
        packageName,
        version: data.version,
        componentName: data.meta.componentName, // 已版本化
        hasComponent: data.hasComponent,
      }
    })
  }

  /**
   * 获取已加载的远程物料列表（兼容旧 API）
   */
  getLoadedMaterials(): Array<{
    name: string
    version: string
    metadata: ComponentMetadata
  }> {
    return Array.from(this.remoteMaterialPackages.entries()).map(([name, data]) => ({
      name,
      version: data.version,
      metadata: data.meta,
    }))
  }

  /**
   * 检查物料是否已加载
   * @param packageName 包名
   * @param version 版本号（可选）
   */
  isLoaded(packageName: string, version?: string): boolean {
    if (version) {
      return this.remoteMaterialPackages.has(`${packageName}@${version}`)
    }

    // 如果没有提供版本，检查是否有任意版本
    for (const key of this.remoteMaterialPackages.keys()) {
      if (key.startsWith(`${packageName}@`)) {
        return true
      }
    }
    return false
  }

  /**
   * 检查物料组件是否已加载
   * @param packageName 包名
   * @param version 版本号（可选）
   */
  hasComponent(packageName: string, version?: string): boolean {
    if (version) {
      return this.remoteMaterialPackages.get(`${packageName}@${version}`)?.hasComponent ?? false
    }

    // 如果没有提供版本，检查任意版本
    for (const [key, value] of this.remoteMaterialPackages.entries()) {
      if (key.startsWith(`${packageName}@`)) {
        return value.hasComponent
      }
    }
    return false
  }

  /**
   * 获取物料信息
   * @param packageName 包名
   * @param version 版本号（可选）
   */
  getPackageInfo(packageName: string, version?: string): CachedMaterialPackage | undefined {
    if (version) {
      return this.remoteMaterialPackages.get(`${packageName}@${version}`)
    }

    // 如果没有提供版本，返回任意版本
    for (const [key, value] of this.remoteMaterialPackages.entries()) {
      if (key.startsWith(`${packageName}@`)) {
        return value
      }
    }
    return undefined
  }

  /**
   * 从版本化的 componentName 中提取原始名称和版本
   * @param versionedName 版本化名称(如 "AreaChart@1.0.0")
   * @returns { name: string, version: string } 或 null
   */
  private parseVersionedName(versionedName: string): { name: string; version: string } | null {
    const lastAtIndex = versionedName.lastIndexOf('@')
    if (lastAtIndex === -1) {
      return null
    }

    return {
      name: versionedName.substring(0, lastAtIndex),
      version: versionedName.substring(lastAtIndex + 1),
    }
  }

  /**
   * 构建版本化的 componentName
   * @param componentName 原始组件名
   * @param version 版本号
   * @returns 版本化名称
   */
  private buildVersionedName(componentName: string, version: string): string {
    return `${componentName}@${version}`
  }

  /**
   * 获取组件的所有版本
   * @param componentName 原始组件名(不含版本)
   * @returns 版本号数组(已排序)
   */
  getComponentVersions(componentName: string): string[] {
    const versions: string[] = []

    for (const [_, data] of this.remoteMaterialPackages.entries()) {
      const metaComponentName = data.meta.componentName

      // 检查是否匹配
      if (metaComponentName.startsWith(`${componentName}@`)) {
        versions.push(data.version)
      }
    }

    // 按版本号排序(简单字符串排序,实际应使用 semver)
    return versions.sort()
  }
}

/** 导出单例 */
export const materialManager = new MaterialManagerClass()

/** 导出类（便于测试） */
export { MaterialManagerClass }
