/**
 * 从版本化的 componentName 中提取原始名称和版本
 * @param versionedName 版本化名称(如 "AreaChart@1.0.0")
 * @returns { name: string, version: string } 或 null
 */
export function parseVersionedName(versionedName: string): { name: string; version: string } | null {
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
export function buildVersionedName(componentName: string, version: string): string {
  return `${componentName}@${version}`
}

/** Register both the pinned runtime name and the plain name stored in schemas. */
export function addComponentNameAliases<T>(target: Record<string, T>, componentName: string, component: T): void {
  target[componentName] = component
  const versionedName = parseVersionedName(componentName)
  if (versionedName) target[versionedName.name] = component
}

/**
 * 从缓存键提取包名（去掉最后的 @version）
 * @param cacheKey 缓存键 (如 "@easy-materials/dashboard@1.0.0")
 * @returns 包名
 */
export function extractPackageName(cacheKey: string): string {
  const lastAtIndex = cacheKey.lastIndexOf('@')
  return lastAtIndex !== -1 ? cacheKey.substring(0, lastAtIndex) : cacheKey
}
