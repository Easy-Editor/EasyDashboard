import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import {
  type MaterialCategory,
  MaterialCategoryLabel,
  type MaterialGroup,
  MaterialGroupLabel,
} from '@/editor/materials/type'
import { materialManager } from '@/editor/remote'
import { type ComponentMeta, project } from '@easy-editor/core'
import { Search, X } from 'lucide-react'
import { observer } from 'mobx-react'
import React, { useState } from 'react'
import { DEBUG_GROUP, DebugSnippet } from './DebugSnippet'
import { MaterialsMenu } from './MaterialsMenu'
import { MaterialsSkeleton } from './MaterialsSkeleton'
import { RemoteSnippet } from './RemoteSnippet'
import { Snippet } from './Snippet'

// 版本比较函数
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0
    const part2 = parts2[i] || 0

    if (part1 > part2) return 1
    if (part1 < part2) return -1
  }

  return 0
}

export const ComponentSidebar = observer(() => {
  const componentMetasMap = project.designer.materials.getComponentMetasMap()
  const [searchTerm, setSearchTerm] = useState('')

  // 构建两级分类映射：group -> category -> components
  const groupCategoryMap = React.useMemo(() => {
    const map = new Map<MaterialGroup | typeof DEBUG_GROUP, Map<string, ComponentMeta[]>>()
    const searchLower = searchTerm.toLowerCase().trim()

    // 第一步：按基础组件名去重，保留最新版本
    const deduplicatedMap = new Map<string, ComponentMeta>()

    componentMetasMap.forEach(meta => {
      const metadata = meta.getMetadata()
      const componentName = metadata.componentName

      // 提取基础组件名（去除版本号）
      const baseComponentName = componentName.includes('@') ? componentName.split('@')[0] : componentName

      // 如果已存在，比较版本号
      const existing = deduplicatedMap.get(baseComponentName)
      if (existing) {
        // 比较版本号，保留较新的版本
        const existingVersion = existing.getMetadata().componentName.split('@')[1] || '0.0.0'
        const currentVersion = componentName.split('@')[1] || '0.0.0'

        if (compareVersions(currentVersion, existingVersion) > 0) {
          deduplicatedMap.set(baseComponentName, meta)
        }
      } else {
        deduplicatedMap.set(baseComponentName, meta)
      }
    })

    // 第二步：构建分类映射（带搜索过滤）
    deduplicatedMap.forEach(meta => {
      const metadata = meta.getMetadata()
      const group = (metadata.group as MaterialGroup | typeof DEBUG_GROUP) || 'basic'
      const category = metadata.category || 'default'

      // 搜索过滤：检查组件名称、标题、snippets 标题
      if (searchLower) {
        const componentName = metadata.componentName.toLowerCase()
        const title = (metadata.title || '').toLowerCase()
        const snippetTitles = metadata.snippets?.map(s => s.title?.toLowerCase() || '') || []

        const matchesSearch =
          componentName.includes(searchLower) ||
          title.includes(searchLower) ||
          snippetTitles.some(t => t.includes(searchLower))

        if (!matchesSearch) {
          return
        }
      }

      // 初始化 group
      if (!map.has(group)) {
        map.set(group, new Map())
      }

      // 初始化 category
      const categoryMap = map.get(group)!
      if (!categoryMap.has(category)) {
        categoryMap.set(category, [])
      }

      // 添加组件
      categoryMap.get(category)!.push(meta)
    })

    return map
  }, [componentMetasMap, searchTerm])

  // 分离调试组和普通组
  const debugCategoryMap = groupCategoryMap.get(DEBUG_GROUP) || new Map()
  const hasMultipleDebugCategories = debugCategoryMap.size > 1 || !debugCategoryMap.has('default')
  groupCategoryMap.delete(DEBUG_GROUP)

  // 对普通组排序
  const sortedGroups = Array.from(groupCategoryMap.keys()).sort((a, b) => a.localeCompare(b))

  return (
    <div className='flex flex-col overflow-y-auto'>
      {/* 顶部工具栏 */}
      <div className='flex items-center justify-between px-4 py-2 border-b border-border/50'>
        <span className='text-sm font-medium'>列表</span>
        <MaterialsMenu />
      </div>

      {/* 搜索框 */}
      <div className='relative px-4 py-3 border-b border-border/30'>
        <Search className='absolute left-7 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none' />
        <Input
          placeholder='搜索物料...'
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className='pl-9 h-9 bg-muted/30 border-border/50 focus:border-primary/50 transition-colors text-sm placeholder:text-sm'
        />
        {searchTerm && (
          <button
            type='button'
            onClick={() => setSearchTerm('')}
            className='absolute right-7 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
            aria-label='Clear search'
          >
            <X className='h-3 w-3' />
          </button>
        )}
      </div>

      {/* 物料列表 */}
      <div className='px-4 pt-2'>
        {/* 加载中的骨架屏 */}
        {materialManager.isLoading ? (
          <MaterialsSkeleton />
        ) : (
          <Accordion type='single' collapsible defaultValue={debugCategoryMap.size > 0 ? DEBUG_GROUP : undefined}>
            {/* 调试中的物料组（如果有） */}
            {debugCategoryMap.size > 0 && (
              <AccordionItem value={DEBUG_GROUP}>
                <AccordionTrigger className='py-2.5 px-3 text-green-600 hover:text-green-700 hover:bg-accent/30 rounded-md transition-all duration-200'>
                  <span className='flex items-center gap-2'>
                    <span className='relative flex h-3 w-3'>
                      <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75' />
                      <span className='relative inline-flex rounded-full h-3 w-3 bg-green-500' />
                    </span>
                    <span className='font-semibold'>调试中</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className='pt-2 pb-3 px-2 transition-all data-[state=closed]:animate-[accordion-up_300ms_ease-out] data-[state=open]:animate-[accordion-down_400ms_ease-out]'>
                  {/* 调试组的二级分类 */}
                  {hasMultipleDebugCategories ? (
                    <Accordion type='single' collapsible className='pl-2'>
                      {Array.from(debugCategoryMap.entries()).map(([category, components]) => (
                        <AccordionItem key={category} value={category}>
                          <AccordionTrigger className='py-2.5 px-4 text-sm hover:bg-accent/30 rounded-md transition-all duration-200'>
                            {MaterialCategoryLabel[category as MaterialCategory] || category}
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className='grid grid-cols-2 gap-2 p-2'>
                              {components.map(component => {
                                const metadata = component.getMetadata()
                                return metadata.snippets?.map(snippet => (
                                  <DebugSnippet
                                    key={`${component.componentName}-${snippet.title}`}
                                    snippet={snippet}
                                    componentMeta={component}
                                  />
                                ))
                              })}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  ) : (
                    Array.from(debugCategoryMap.entries()).map(([category, components]) => (
                      <div key={category} className='grid grid-cols-2 gap-2 p-2'>
                        {components.map(component => {
                          const metadata = component.getMetadata()
                          return metadata.snippets?.map(snippet => (
                            <DebugSnippet
                              key={`${component.componentName}-${snippet.title}`}
                              snippet={snippet}
                              componentMeta={component}
                            />
                          ))
                        })}
                      </div>
                    ))
                  )}
                </AccordionContent>
              </AccordionItem>
            )}

            {/* 普通物料组 */}
            {sortedGroups
              .filter(group => group.toLowerCase() !== 'inner')
              .map(group => {
                const categoryMap = groupCategoryMap.get(group)!
                const hasMultipleCategories = categoryMap.size > 1 || !categoryMap.has('default')

                return (
                  <AccordionItem key={group} value={group}>
                    <AccordionTrigger className='py-2.5 px-3 text-sm font-medium hover:bg-accent/50 rounded-md transition-all duration-200 data-[state=open]:bg-accent/30'>
                      {MaterialGroupLabel[group as MaterialGroup] || group}
                    </AccordionTrigger>
                    <AccordionContent className='pt-2 pb-3 px-2 transition-all data-[state=closed]:animate-[accordion-up_300ms_ease-out] data-[state=open]:animate-[accordion-down_400ms_ease-out]'>
                      {hasMultipleCategories ? (
                        /* 有多个二级分类时，显示嵌套结构 */
                        <Accordion type='single' collapsible className='pl-2 border-l border-border/50'>
                          {Array.from(categoryMap.entries())
                            .sort((a, b) => a[0].localeCompare(b[0]))
                            .map(([category, components]) => (
                              <AccordionItem key={category} value={category}>
                                <AccordionTrigger className='py-2.5 px-4 text-sm font-normal hover:bg-accent/30 rounded-md transition-all duration-200'>
                                  {MaterialCategoryLabel[category as MaterialCategory] || category}
                                </AccordionTrigger>
                                <AccordionContent>
                                  <div className='grid grid-cols-2 gap-2 p-2'>
                                    {components.map(component => {
                                      const metadata = component.getMetadata()
                                      const isRemoteMaterial = component.isRemoteMaterial()

                                      return metadata.snippets?.map(snippet =>
                                        isRemoteMaterial ? (
                                          <RemoteSnippet
                                            key={`${component.componentName}-${snippet.title}`}
                                            snippet={snippet}
                                            componentMeta={component}
                                          />
                                        ) : (
                                          <Snippet
                                            key={`${component.componentName}-${snippet.title}`}
                                            snippet={snippet}
                                            componentMeta={component}
                                          />
                                        ),
                                      )
                                    })}
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            ))}
                        </Accordion>
                      ) : (
                        /* 只有一个 default 分类时，直接平铺显示 */
                        <div className='grid grid-cols-2 gap-2 p-2'>
                          {Array.from(categoryMap.values())[0]?.map(component => {
                            const metadata = component.getMetadata()
                            const isRemoteMaterial = component.isRemoteMaterial()

                            return metadata.snippets?.map(snippet =>
                              isRemoteMaterial ? (
                                <RemoteSnippet
                                  key={`${component.componentName}-${snippet.title}`}
                                  snippet={snippet}
                                  componentMeta={component}
                                />
                              ) : (
                                <Snippet
                                  key={`${component.componentName}-${snippet.title}`}
                                  snippet={snippet}
                                  componentMeta={component}
                                />
                              ),
                            )
                          })}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
          </Accordion>
        )}
      </div>
    </div>
  )
})
