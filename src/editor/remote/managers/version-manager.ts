/**
 * Version Manager
 * 版本管理器 - 负责远程组件的版本检查和更新
 */

import { type Node, type NpmInfo, project } from '@easy-editor/core'
import { makeAutoObservable, runInAction } from 'mobx'
import { versionResolver } from '../loaders/version-resolver'
import { materialManager } from './material-manager'

/** 版本检查结果 */
export interface VersionCheckResult {
  /** 节点 ID */
  nodeId: string
  /** 组件名称 */
  componentName: string
  /** 当前版本 */
  currentVersion: string
  /** 最新版本 */
  latestVersion: string
  /** 是否有更新 */
  hasUpdate: boolean
  /** 包名 */
  packageName: string
}

/**
 * 版本管理器类
 */
class VersionManagerClass {
  // 缓存版本检查结果（nodeId -> result）
  private checkCache = new Map<string, VersionCheckResult>()

  constructor() {
    makeAutoObservable(this)
  }

  /**
   * 检查单个节点的版本更新
   * @param node 节点实例
   * @returns 版本检查结果，如果不是远程组件则返回 null
   */
  async checkNodeUpdate(node: Node): Promise<VersionCheckResult | null> {
    const npm = node.getExtraPropValue('npm') as NpmInfo

    // 仅检查远程组件
    if (!npm || !npm.package || !npm.version) {
      return null
    }

    // 检查缓存
    const cached = this.checkCache.get(node.id)
    if (cached) {
      return cached
    }

    try {
      const currentVersion = npm.version
      const packageName = npm.package

      // 解析当前版本和最新版本（包括 latest 标签）
      const currentResolved = await versionResolver.resolve(packageName, currentVersion)
      const latestResolved = await versionResolver.resolve(packageName, 'latest')

      const hasUpdate = currentResolved !== latestResolved

      const result: VersionCheckResult = {
        nodeId: node.id,
        componentName: node.componentMeta.title,
        currentVersion: currentResolved,
        latestVersion: latestResolved,
        hasUpdate,
        packageName,
      }

      // 缓存结果
      this.checkCache.set(node.id, result)
      return result
    } catch (error) {
      console.error(`[VersionManager] Failed to check update for node ${node.id}:`, error)
      return null
    }
  }

  /**
   * 批量检查画布所有节点的版本更新
   * @param rootNode 根节点
   * @returns 所有有更新的节点列表
   */
  async checkAllNodesUpdate(rootNode: Node): Promise<VersionCheckResult[]> {
    const results: VersionCheckResult[] = []

    // 递归收集所有节点
    const collectNodes = (node: Node): Node[] => {
      const nodes: Node[] = [node]
      if (node.childrenNodes) {
        for (const child of node.childrenNodes) {
          nodes.push(...collectNodes(child))
        }
      }
      return nodes
    }

    const allNodes = collectNodes(rootNode)

    // 并发检查（限制并发数为 5）
    const concurrency = 5
    for (let i = 0; i < allNodes.length; i += concurrency) {
      const batch = allNodes.slice(i, i + concurrency)
      const batchResults = await Promise.all(batch.map(node => this.checkNodeUpdate(node)))
      results.push(...(batchResults.filter(r => r !== null) as VersionCheckResult[]))
    }

    return results
  }

  /**
   * 更新单个节点到指定版本
   * @param node 节点实例
   * @param targetVersion 目标版本
   */
  async updateNode(node: Node, targetVersion: string): Promise<void> {
    const npm = node.getExtraPropValue('npm') as NpmInfo

    if (!npm || !npm.package) {
      throw new Error('Node does not have npm info')
    }

    const originVersion = npm.version!

    try {
      // 1. 加载目标版本的组件代码
      await materialManager.loadComponentVersion(npm.package, targetVersion, originVersion)

      // 2. 更新节点的 npm.version
      runInAction(() => {
        node.setExtraPropValue('npm.version', targetVersion)

        // 清除版本检查缓存
        this.checkCache.delete(node.id)
        node.refreshSettingEntry()
      })
    } catch (error) {
      console.error(`[VersionManager] Failed to update node ${node.id}:`, error)

      // 回滚
      runInAction(() => {
        node.setExtraPropValue('npm.version', originVersion)
      })

      throw error
    }
  }

  /**
   * 批量更新节点
   * @param updates 更新列表
   */
  async updateNodes(updates: Array<{ nodeId: string; targetVersion: string }>): Promise<void> {
    const currentDoc = project.currentDocument

    if (!currentDoc || !currentDoc.rootNode) {
      throw new Error('No current document')
    }

    // 收集所有节点
    const nodeMap = new Map<string, Node>()
    const collectNodes = (node: Node) => {
      nodeMap.set(node.id, node)
      if (node.childrenNodes) {
        for (const child of node.childrenNodes) {
          collectNodes(child)
        }
      }
    }
    collectNodes(currentDoc.rootNode)

    // 批量更新
    for (const { nodeId, targetVersion } of updates) {
      const node = nodeMap.get(nodeId)
      if (node) {
        await this.updateNode(node, targetVersion)
      }
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.checkCache.clear()
  }
}

/** 导出单例 */
export const versionManager = new VersionManagerClass()

/** 导出类（便于测试） */
export { VersionManagerClass }
