import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialSource, materials } from '@easy-editor/core'
import { runInAction } from 'mobx'
import { DEBUG_GROUP } from './constants'
import type { LoadedMaterialModule } from './types'

/**
 * 注册物料到 materials 系统
 */
export function registerMaterial(url: string, module: LoadedMaterialModule): void {
  const meta = module.meta
  if (!meta) {
    throw new Error('Material meta is required')
  }

  // 获取组件
  const component = module.component || module.default

  // 创建干净的元数据副本
  const registrationMeta: ComponentMetadata = {
    ...meta,
    // 强制设置为调试分组
    group: DEBUG_GROUP,
    // 深拷贝 configure，设置 view 为加载的组件
    configure: meta.configure
      ? {
          ...meta.configure,
          advanced: {
            ...meta.configure.advanced,
            view: component,
          },
        }
      : {
          advanced: {
            view: component,
          },
        },
  }

  // 使用 runInAction 确保 MobX 响应式正确触发
  runInAction(() => {
    // 注册物料，标记为本地调试物料
    materials.createComponentMeta(registrationMeta, {
      source: MaterialSource.DEBUG,
      component,
    })

    // 在 registry 的 extensions 中存储调试信息
    const entry = materials.registry.get(meta.componentName)
    if (entry) {
      entry.extensions = entry.extensions || new Map()
      entry.extensions.set('devServerUrl', url)
      entry.extensions.set('isLocalDebug', true)
    }

    // 强制刷新 componentMetasMap
    materials.refreshComponentMetasMap()
  })
}

/**
 * 从 materials 系统移除物料
 */
export function unregisterMaterial(componentName: string): void {
  runInAction(() => {
    try {
      materials.removeComponentMeta(componentName)
    } catch (error) {
      console.warn('[LocalMaterialLoader] Failed to remove material from registry:', error)
    }
  })
}
