/**
 * Material Manager
 * 物料管理器
 */

import { type Component, type ComponentMetadata, MaterialSource, materials } from '@easy-editor/core'
import { action, computed, observable, runInAction } from 'mobx'
import { type LoadedMaterial, materialLoader } from '../../loaders'
import type { BatchLoadResult, CachedMaterialPackage, RemoteMaterialConfig } from './types'
import { buildVersionedName, extractPackageName } from './utils'

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
   */
  @computed
  get remoteComponentsMap(): Record<string, Component> {
    const componentsMap: Record<string, Component> = {}

    for (const [_, data] of this.remoteMaterialPackages.entries()) {
      const { component, meta } = data
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

    if (!enabled) return

    try {
      const meta = await materialLoader.loadMeta({ package: packageName, version, globalName })
      const versionedComponentName = buildVersionedName(meta.componentName, version)
      materials.buildComponentMetasMap([{ ...meta, componentName: versionedComponentName }])

      const cacheKey = `${packageName}@${version}`
      runInAction(() => {
        this.remoteMaterialPackages.set(cacheKey, {
          version,
          globalName,
          meta: { ...meta, componentName: versionedComponentName },
          hasComponent: false,
        })
      })
    } catch (error) {
      console.error(`[MaterialManager] Failed to load meta: ${packageName}@${version}`, error)
      throw error
    }
  }

  /**
   * 批量加载远程物料元数据
   */
  @action
  async loadMetaMultiple(configs: RemoteMaterialConfig[]): Promise<BatchLoadResult> {
    this.isLoading = true

    try {
      const results = await Promise.allSettled(configs.map(config => this.loadMeta(config)))
      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const failed = results.filter(r => r.status === 'rejected').length

      return { total: configs.length, succeeded, failed }
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
      const loaded = await materialLoader.loadMaterial({ package: packageName, version, globalName })

      runInAction(() => {
        const versionedComponentName = buildVersionedName(loaded.meta.componentName, version)

        materials.createComponentMeta(
          { ...loaded.meta, componentName: versionedComponentName },
          { component: loaded.component, source: MaterialSource.REMOTE },
        )

        materials.refreshComponentMetasMap()

        const cacheKey = `${packageName}@${version}`
        this.remoteMaterialPackages.set(cacheKey, {
          version,
          globalName,
          meta: { ...loaded.meta, componentName: versionedComponentName },
          component: loaded.component,
          hasComponent: true,
        })
      })

      return loaded
    } catch (error) {
      console.error(`[MaterialManager] Failed to load full material: ${packageName}@${version}`, error)
      throw error
    }
  }

  /**
   * 批量加载完整物料
   */
  @action
  async loadFullMultiple(configs: RemoteMaterialConfig[]): Promise<BatchLoadResult> {
    this.isLoading = true

    try {
      const results = await Promise.allSettled(configs.map(config => this.loadFull(config)))
      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const failed = results.filter(r => r.status === 'rejected').length

      return { total: configs.length, succeeded, failed }
    } finally {
      this.isLoading = false
    }
  }

  /**
   * 为已加载元数据的物料添加组件代码
   */
  @action
  async addComponent(packageName: string, version?: string): Promise<void> {
    const cacheKey = version ? `${packageName}@${version}` : packageName
    let cached = this.remoteMaterialPackages.get(cacheKey)

    if (!cached && !version) {
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

    if (cached.hasComponent) return

    try {
      const component = await materialLoader.addComponent({
        package: packageName,
        version: cached.version,
        globalName: cached.globalName,
      })

      runInAction(() => {
        const finalComponentName = cached.meta.componentName.includes('@')
          ? cached.meta.componentName
          : buildVersionedName(cached.meta.componentName, cached.version)

        materials.createComponentMeta(
          { ...cached.meta, componentName: finalComponentName },
          { component, source: MaterialSource.REMOTE },
        )

        materials.refreshComponentMetasMap()

        const finalCacheKey = `${packageName}@${cached.version}`
        this.remoteMaterialPackages.set(finalCacheKey, {
          ...cached,
          meta: { ...cached.meta, componentName: finalComponentName },
          component,
          hasComponent: true,
        })
      })
    } catch (error) {
      console.error(`[MaterialManager] Failed to add component: ${packageName}`, error)
      throw error
    }
  }

  /**
   * 加载指定版本的组件（用于版本更新）
   */
  @action
  async loadComponentVersion(packageName: string, version: string, originVersion: string): Promise<void> {
    const cacheKey = `${packageName}@${version}`
    const cached = this.remoteMaterialPackages.get(cacheKey)

    if (cached?.hasComponent) return

    const originCacheKey = `${packageName}@${originVersion}`
    const originCached = this.remoteMaterialPackages.get(originCacheKey)

    if (!originCached) {
      throw new Error(`Material ${packageName}@${originVersion} not found in cache`)
    }

    try {
      const loaded = await materialLoader.loadMaterial({
        package: packageName,
        version,
        globalName: originCached?.globalName || '',
      })

      runInAction(() => {
        const versionedComponentName = buildVersionedName(loaded.meta.componentName, version)
        materials.createComponentMeta(
          { ...loaded.meta, componentName: versionedComponentName },
          { component: loaded.component, source: MaterialSource.REMOTE },
        )

        materials.refreshComponentMetasMap()

        this.remoteMaterialPackages.set(cacheKey, {
          version,
          globalName: loaded.meta.npm?.globalName || '',
          meta: loaded.meta,
          component: loaded.component,
          hasComponent: true,
        })
      })
    } catch (error) {
      console.error(`[MaterialManager] Failed to load component version: ${packageName}@${version}`, error)
      throw error
    }
  }

  /**
   * 批量加载完整物料（带详细结果）
   */
  @action
  async loadMaterialMultiple(
    configs: RemoteMaterialConfig[],
  ): Promise<BatchLoadResult & { results: PromiseSettledResult<LoadedMaterial>[] }> {
    const results = await Promise.allSettled(configs.map(config => this.loadFull(config)))
    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    return { total: configs.length, succeeded, failed, results }
  }

  /**
   * 获取已加载的远程物料包列表
   */
  getLoadedPackages(): Array<{
    packageName: string
    version: string
    componentName: string
    hasComponent: boolean
  }> {
    return Array.from(this.remoteMaterialPackages.entries()).map(([cacheKey, data]) => ({
      packageName: extractPackageName(cacheKey),
      version: data.version,
      componentName: data.meta.componentName,
      hasComponent: data.hasComponent,
    }))
  }

  /**
   * 获取已加载的远程物料列表（兼容旧 API）
   */
  getLoadedMaterials(): Array<{ name: string; version: string; metadata: ComponentMetadata }> {
    return Array.from(this.remoteMaterialPackages.entries()).map(([name, data]) => ({
      name,
      version: data.version,
      metadata: data.meta,
    }))
  }

  /**
   * 检查物料是否已加载
   */
  isLoaded(packageName: string, version?: string): boolean {
    if (version) {
      return this.remoteMaterialPackages.has(`${packageName}@${version}`)
    }

    for (const key of this.remoteMaterialPackages.keys()) {
      if (key.startsWith(`${packageName}@`)) {
        return true
      }
    }
    return false
  }

  /**
   * 检查物料组件是否已加载
   */
  hasComponent(packageName: string, version?: string): boolean {
    if (version) {
      return this.remoteMaterialPackages.get(`${packageName}@${version}`)?.hasComponent ?? false
    }

    for (const [key, value] of this.remoteMaterialPackages.entries()) {
      if (key.startsWith(`${packageName}@`)) {
        return value.hasComponent
      }
    }
    return false
  }

  /**
   * 获取物料信息
   */
  getPackageInfo(packageName: string, version?: string): CachedMaterialPackage | undefined {
    if (version) {
      return this.remoteMaterialPackages.get(`${packageName}@${version}`)
    }

    for (const [key, value] of this.remoteMaterialPackages.entries()) {
      if (key.startsWith(`${packageName}@`)) {
        return value
      }
    }
    return undefined
  }

  /**
   * 获取组件的所有版本
   */
  getComponentVersions(componentName: string): string[] {
    const versions: string[] = []

    for (const [_, data] of this.remoteMaterialPackages.entries()) {
      if (data.meta.componentName.startsWith(`${componentName}@`)) {
        versions.push(data.version)
      }
    }

    return versions.sort()
  }
}

/** 导出单例 */
export const materialManager = new MaterialManagerClass()

/** 导出类（便于测试） */
export { MaterialManagerClass }

/** 导出类型 */
export type { BatchLoadResult, CachedMaterialPackage, RemoteMaterialConfig } from './types'
