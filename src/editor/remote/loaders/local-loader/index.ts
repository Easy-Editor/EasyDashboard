/**
 * Local Material Loader
 * 本地物料加载器 - 用于开发模式下的本地物料调试
 *
 * 支持：
 * - 连接 Vite 开发服务器
 * - 加载完整物料模块（component、meta、configure、snippets）
 * - 注册到 materials 系统
 * - Vite HMR 热更新
 */

import { checkHealth, fetchMaterialInfo, loadMaterialModule } from './api'
import { WS_RECONNECT_CONFIG } from './constants'
import { EventEmitter } from './eventEmitter'
import { registerMaterial, unregisterMaterial } from './registry'
import type { LoadedMaterialModule, LocalMaterialConfig, MaterialConnection, MaterialServerInfo } from './types'

/**
 * 本地物料加载器
 * 用于连接本地开发服务器并加载物料到编辑器
 */
class LocalMaterialLoaderClass extends EventEmitter {
  /** 活动连接 */
  private connections = new Map<string, MaterialConnection>()

  /** 模块缓存版本（用于强制刷新） */
  private moduleVersion = new Map<string, number>()

  /**
   * 连接本地物料开发服务器
   */
  async connect(config: LocalMaterialConfig): Promise<LoadedMaterialModule> {
    const { devServerUrl } = config
    const normalizedUrl = this.normalizeUrl(devServerUrl)

    // 检查是否已连接
    if (this.connections.has(normalizedUrl)) {
      console.warn(`[LocalMaterialLoader] Already connected to ${normalizedUrl}`)
      return this.connections.get(normalizedUrl)!.module
    }

    try {
      // 1. 健康检查
      await checkHealth(normalizedUrl)
      this.emit('status', { url: normalizedUrl, status: 'checking' })

      // 2. 获取物料信息
      const info = await fetchMaterialInfo(normalizedUrl)
      this.emit('status', { url: normalizedUrl, status: 'loading', info })

      // 3. 动态导入物料模块
      const module = await this.loadModule(normalizedUrl, info.entry)

      if (!module.meta) {
        throw new Error('Material meta not found in module')
      }

      // 4. 注册到 materials 系统
      registerMaterial(normalizedUrl, module)

      // 5. 建立 HMR 连接
      const ws = this.setupViteHMR(normalizedUrl, info)

      // 6. 缓存连接信息
      const connection: MaterialConnection = {
        url: normalizedUrl,
        componentName: module.meta.componentName,
        module,
        ws,
        info,
        reconnect: { retries: 0, isReconnecting: false },
      }
      this.connections.set(normalizedUrl, connection)

      this.emit('connected', {
        url: normalizedUrl,
        componentName: module.meta.componentName,
        meta: module.meta,
      })

      return module
    } catch (error) {
      this.emit('error', { url: normalizedUrl, error })
      throw error
    }
  }

  /**
   * 断开连接
   */
  disconnect(devServerUrl: string): void {
    const normalizedUrl = this.normalizeUrl(devServerUrl)
    const connection = this.connections.get(normalizedUrl)

    if (!connection) {
      console.warn(`[LocalMaterialLoader] Not connected to ${normalizedUrl}`)
      return
    }

    // 清除重连定时器
    if (connection.reconnect.timer) {
      clearTimeout(connection.reconnect.timer)
    }

    // 关闭 WebSocket
    if (connection.ws) {
      connection.ws.close()
    }

    // 从 materials 系统移除
    unregisterMaterial(connection.componentName)

    // 清理缓存
    this.connections.delete(normalizedUrl)
    this.moduleVersion.delete(normalizedUrl)

    this.emit('disconnected', {
      url: normalizedUrl,
      componentName: connection.componentName,
    })
  }

  /**
   * 断开所有连接
   */
  disconnectAll(): void {
    const urls = Array.from(this.connections.keys())
    for (const url of urls) {
      this.disconnect(url)
    }
  }

  /**
   * 获取所有活动连接
   */
  getConnections(): Array<{ url: string; componentName: string }> {
    return Array.from(this.connections.entries()).map(([url, conn]) => ({
      url,
      componentName: conn.componentName,
    }))
  }

  /**
   * 检查是否已连接
   */
  isConnected(devServerUrl: string): boolean {
    return this.connections.has(this.normalizeUrl(devServerUrl))
  }

  /**
   * 手动刷新物料（当 HMR 不工作时使用）
   */
  async refresh(devServerUrl: string): Promise<void> {
    const normalizedUrl = this.normalizeUrl(devServerUrl)
    const connection = this.connections.get(normalizedUrl)

    if (!connection) {
      throw new Error(`Not connected to ${normalizedUrl}`)
    }

    await this.handleHMRUpdate(normalizedUrl, connection.info)
  }

  /**
   * 动态加载物料模块
   */
  private async loadModule(baseUrl: string, entry: string): Promise<LoadedMaterialModule> {
    const version = (this.moduleVersion.get(baseUrl) || 0) + 1
    this.moduleVersion.set(baseUrl, version)
    return loadMaterialModule(baseUrl, entry, version) as Promise<LoadedMaterialModule>
  }

  /**
   * 设置 Vite HMR 监听
   */
  private setupViteHMR(url: string, info: MaterialServerInfo): WebSocket | undefined {
    try {
      const wsPath = info.wsPath || '/ws'
      const wsProtocol = url.startsWith('https') ? 'wss' : 'ws'
      const wsUrl = `${url.replace(/^https?/, wsProtocol)}${wsPath}`

      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        this.emit('ws:connected', { url })
        const connection = this.connections.get(url)
        if (connection) {
          connection.reconnect.retries = 0
          connection.reconnect.isReconnecting = false
        }
      }

      ws.onmessage = async event => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'update') {
            await this.handleHMRUpdate(url, info)
          }
        } catch {
          // 忽略非 JSON 消息
        }
      }

      ws.onerror = error => {
        console.warn('[LocalMaterialLoader] HMR WebSocket connection failed:', error)
        this.emit('ws:error', { url, error })
      }

      ws.onclose = () => {
        this.emit('ws:closed', { url })
        this.scheduleReconnect(url, info)
      }

      return ws
    } catch (error) {
      console.warn('[LocalMaterialLoader] Failed to setup HMR:', error)
      return undefined
    }
  }

  /**
   * 计划 WebSocket 重连
   */
  private scheduleReconnect(url: string, info: MaterialServerInfo): void {
    const connection = this.connections.get(url)
    if (!connection) return

    if (connection.reconnect.retries >= WS_RECONNECT_CONFIG.maxRetries) {
      console.warn(`[LocalMaterialLoader] Max reconnection attempts reached for ${url}`)
      this.emit('ws:reconnect:failed', { url, retries: connection.reconnect.retries })
      return
    }

    const delay = Math.min(
      WS_RECONNECT_CONFIG.initialDelay * WS_RECONNECT_CONFIG.backoffFactor ** connection.reconnect.retries,
      WS_RECONNECT_CONFIG.maxDelay,
    )

    connection.reconnect.retries++
    connection.reconnect.isReconnecting = true

    this.emit('ws:reconnecting', { url, attempt: connection.reconnect.retries, delay })

    if (connection.reconnect.timer) {
      clearTimeout(connection.reconnect.timer)
    }

    connection.reconnect.timer = setTimeout(() => {
      if (!this.connections.has(url)) return
      const newWs = this.setupViteHMR(url, info)
      if (newWs) {
        connection.ws = newWs
      }
    }, delay)
  }

  /**
   * 处理 HMR 更新
   */
  private async handleHMRUpdate(url: string, info: MaterialServerInfo): Promise<void> {
    try {
      const module = await this.loadModule(url, info.entry)

      if (module.meta) {
        registerMaterial(url, module)

        const connection = this.connections.get(url)
        if (connection) {
          connection.module = module
        }

        this.emit('hmr:update', {
          url,
          componentName: module.meta.componentName,
          module,
        })
      }
    } catch (error) {
      console.error('[LocalMaterialLoader] HMR update failed:', error)
      this.emit('hmr:error', { url, error })
    }
  }

  /**
   * 规范化 URL
   */
  private normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '')
  }
}

// 导出单例
export const localLoader = new LocalMaterialLoaderClass()

// 导出类和类型
export { LocalMaterialLoaderClass }
export type { LoadedMaterialModule, LocalMaterialConfig, MaterialConnection, MaterialServerInfo } from './types'
