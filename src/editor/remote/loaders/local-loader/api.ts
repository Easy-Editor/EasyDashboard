import type { MaterialServerInfo } from './types'

/**
 * 健康检查
 */
export async function checkHealth(url: string): Promise<void> {
  try {
    const response = await fetch(`${url}/api/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`)
    }

    const data = await response.json()
    if (data.status !== 'ok') {
      throw new Error('Server health check failed')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot connect to dev server at ${url}: ${message}`)
  }
}

/**
 * 获取物料信息
 */
export async function fetchMaterialInfo(url: string): Promise<MaterialServerInfo> {
  try {
    const response = await fetch(`${url}/api/material`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `Server responded with status ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to fetch material info: ${message}`)
  }
}

/**
 * 动态加载物料模块
 */
export async function loadMaterialModule(
  baseUrl: string,
  entry: string,
  version: number,
): Promise<Record<string, unknown>> {
  try {
    // 尝试使用 Module Federation 的方式加载
    if (typeof window !== 'undefined' && 'materials_audio' in window) {
      const getModule = (
        window as unknown as { __federation_get?: (remote: string, module: string) => Promise<unknown> }
      ).__federation_get
      if (getModule) {
        const module = await getModule('materials_audio', './Audio')
        return module as Record<string, unknown>
      }
    }

    // 回退到普通的动态 import
    const moduleUrl = `${baseUrl}${entry}?t=${Date.now()}&v=${version}`
    const module = await import(/* @vite-ignore */ moduleUrl)
    return module
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to load material module: ${message}`)
  }
}
