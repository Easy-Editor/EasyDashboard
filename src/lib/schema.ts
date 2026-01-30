import { defaultProjectSchema } from '@/editor/const'
import type { ProjectSchema, RootSchema } from '@easy-editor/core'

const PROJECT_SCHEMA = 'projectSchema'
const PAGE_INFO = 'pageInfo'
const PREFIX_PAGE_SCHEMA = 'pageSchema'

const getPageName = (pageId: string) => {
  return `${PREFIX_PAGE_SCHEMA}:${pageId}`
}

/** 页面元数据 */
export interface PageMeta {
  fileName: string
  fileDesc: string
}

/** 页面存储数据结构 - 与 ProjectSchema 保持一致，componentsTree 只有一个元素 */
export type PageStorageData = ProjectSchema<RootSchema>

export const getProjectSchemaFromLocalStorage = (): ProjectSchema => {
  const projectSchema = localStorage.getItem(PROJECT_SCHEMA)
  return projectSchema ? JSON.parse(projectSchema) : defaultProjectSchema
}

export const saveProjectSchemaToLocalStorage = (schema: ProjectSchema) => {
  localStorage.setItem(PROJECT_SCHEMA, JSON.stringify(schema))
}

/**
 * 获取单个页面数据（ProjectSchema 格式，componentsTree 只有一个元素）
 */
export const getPageDataFromLocalStorage = (pageId: string): PageStorageData | null => {
  const data = localStorage.getItem(getPageName(pageId))
  if (!data) return null

  const parsed = JSON.parse(data)
  // 兼容旧格式：如果是 { schema, componentsMap } 格式，转换为 ProjectSchema 格式
  if (parsed.schema && !parsed.componentsTree) {
    return {
      version: '1.0.0',
      componentsTree: [parsed.schema],
      componentsMap: parsed.componentsMap || [],
    }
  }
  return parsed as PageStorageData
}

/**
 * 保存单个页面数据（ProjectSchema 格式）
 */
export const savePageDataToLocalStorage = (pageId: string, data: PageStorageData) => {
  localStorage.setItem(getPageName(pageId), JSON.stringify(data))
}

/**
 * 获取页面元数据列表
 */
export const getPageMetaListFromLocalStorage = (): PageMeta[] => {
  const pageInfo = localStorage.getItem(PAGE_INFO)
  return pageInfo ? JSON.parse(pageInfo) : []
}

/**
 * 保存页面元数据列表
 */
export const savePageMetaListToLocalStorage = (info: PageMeta[]) => {
  localStorage.setItem(PAGE_INFO, JSON.stringify(info))
}

// 保留旧函数以兼容
export const getPageSchemaFromLocalStorage = (pageId: string) => {
  const pageSchema = localStorage.getItem(getPageName(pageId))
  return pageSchema ? (JSON.parse(pageSchema) as ProjectSchema) : null
}

export const savePageSchemaToLocalStorage = (pageId: string, schema: RootSchema) => {
  const data: ProjectSchema = {
    componentsTree: [schema],
    version: '1.0.0',
  }
  localStorage.setItem(getPageName(pageId), JSON.stringify(data))
}

export const savePageInfoToLocalStorage = (info: Array<{ path: string; title: string }>) => {
  localStorage.setItem(PAGE_INFO, JSON.stringify(info))
}

export const getPageInfoFromLocalStorage = (): Array<{ path: string; title: string }> => {
  const pageInfo = localStorage.getItem(PAGE_INFO)
  return pageInfo ? JSON.parse(pageInfo) : []
}
