import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Card, CardContent } from '@/components/ui/card'
import {
  type MaterialCategory,
  MaterialCategoryLabel,
  type MaterialGroup,
  MaterialGroupLabel,
} from '@/editor/materials/type'
import { cn } from '@/lib/utils'
import { type ComponentMeta, type Snippet as ISnippet, project } from '@easy-editor/core'
import { observer } from 'mobx-react'
import React from 'react'
import { MaterialsMenu } from './MaterialsMenu'
import { RemoteSnippet } from './RemoteSnippet'

/** 调试分组名称 */
const DEBUG_GROUP = 'DEBUG'

interface SnippetProps {
  snippet: ISnippet
  componentMeta: ComponentMeta
}

/**
 * 本地物料 Snippet 组件
 */
const Snippet = ({ snippet }: SnippetProps) => {
  const ref = React.useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)

  React.useEffect(() => {
    const element = ref.current
    if (!element) return

    const handleDragStart = () => setIsDragging(true)
    const handleDragEnd = () => setIsDragging(false)

    element.addEventListener('dragstart', handleDragStart)
    element.addEventListener('dragend', handleDragEnd)

    // 使用 linkSnippet 处理拖拽
    const unlink = project.simulator?.linkSnippet(element, snippet)

    return () => {
      element.removeEventListener('dragstart', handleDragStart)
      element.removeEventListener('dragend', handleDragEnd)
      unlink?.()
    }
  }, [snippet])

  return (
    <Card
      ref={ref}
      role='button'
      aria-label={`Drag ${snippet.title} to canvas`}
      tabIndex={0}
      className={cn(
        'group relative overflow-hidden cursor-move select-none aspect-square',
        'border border-border/60 bg-surface hover:bg-surface-hover',
        'transition-all duration-300 ease-out',
        'hover:shadow-lg hover:scale-[1.02] hover:border-border-strong',
        'active:scale-[0.98]',
        isDragging && 'opacity-40 scale-95',
      )}
    >
      <CardContent className='relative flex flex-col items-center justify-between w-full h-full p-3 gap-2'>
        {snippet.screenshot && (
          <div className='flex-1 w-full rounded-md overflow-hidden bg-muted/20 border border-border/40'>
            <img
              src={snippet.screenshot}
              alt={`Preview of ${snippet.title}`}
              className='w-full h-full object-contain transition-transform duration-300 group-hover:scale-105'
              loading='lazy'
            />
          </div>
        )}
        <span
          className={cn(
            'w-full text-xs font-medium text-center line-clamp-2',
            'text-muted-foreground group-hover:text-foreground',
            'transition-colors duration-200',
          )}
        >
          {snippet.title}
        </span>
      </CardContent>
    </Card>
  )
}

/**
 * 调试中物料 Snippet 组件
 * 带有特殊的视觉指示
 */
const DebugSnippet = ({ snippet, componentMeta }: SnippetProps) => {
  const ref = React.useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)

  React.useEffect(() => {
    const element = ref.current
    if (!element) return

    const handleDragStart = () => setIsDragging(true)
    const handleDragEnd = () => setIsDragging(false)

    element.addEventListener('dragstart', handleDragStart)
    element.addEventListener('dragend', handleDragEnd)

    // 使用 linkSnippet 处理拖拽
    const unlink = project.simulator?.linkSnippet(element, snippet)

    return () => {
      element.removeEventListener('dragstart', handleDragStart)
      element.removeEventListener('dragend', handleDragEnd)
      unlink?.()
    }
  }, [snippet])

  return (
    <Card
      ref={ref}
      role='button'
      aria-label={`Drag ${snippet.title} to canvas (Debug mode)`}
      tabIndex={0}
      className={cn(
        'group relative overflow-hidden cursor-move select-none aspect-square',
        'border-2 border-green-500/30 bg-surface hover:bg-surface-hover',
        'transition-all duration-300 ease-out',
        'hover:shadow-lg hover:scale-[1.02] hover:border-green-500/70',
        'active:scale-[0.98]',
        isDragging && 'opacity-40 scale-95',
      )}
    >
      {/* 调试标记 */}
      <div className='absolute top-2 right-2 flex items-center gap-1 bg-green-500 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-md shadow-sm z-10'>
        <span className='h-1.5 w-1.5 rounded-full bg-white animate-pulse' />
        DEV
      </div>
      {/* 背景装饰 */}
      <div className='absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent pointer-events-none' />
      <CardContent className='relative flex flex-col items-center justify-between w-full h-full p-3 gap-2'>
        {snippet.screenshot && (
          <div className='flex-1 w-full rounded-md overflow-hidden bg-muted/20 border border-border/40'>
            <img
              src={snippet.screenshot}
              alt={`Preview of ${snippet.title}`}
              className='w-full h-full object-contain transition-transform duration-300 group-hover:scale-105'
              loading='lazy'
            />
          </div>
        )}
        <span
          className={cn(
            'w-full text-xs font-medium text-center line-clamp-2',
            'text-muted-foreground group-hover:text-foreground',
            'transition-colors duration-200',
          )}
        >
          {snippet.title}
        </span>
      </CardContent>
    </Card>
  )
}

export const ComponentSidebar = observer(() => {
  const componentMetasMap = project.designer.materials.getComponentMetasMap()

  // 构建两级分类映射：group -> category -> components
  const groupCategoryMap = React.useMemo(() => {
    const map = new Map<MaterialGroup | typeof DEBUG_GROUP, Map<string, ComponentMeta[]>>()

    componentMetasMap.forEach(meta => {
      const metadata = meta.getMetadata()
      const group = (metadata.group as MaterialGroup | typeof DEBUG_GROUP) || 'basic'
      const category = metadata.category || 'default'

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
  }, [componentMetasMap])

  // 分离调试组和普通组
  const debugCategoryMap = groupCategoryMap.get(DEBUG_GROUP) || new Map()
  groupCategoryMap.delete(DEBUG_GROUP)

  // 对普通组排序
  const sortedGroups = Array.from(groupCategoryMap.keys()).sort((a, b) => a.localeCompare(b))

  return (
    <div className='flex flex-col overflow-y-auto'>
      {/* 顶部工具栏 */}
      <div className='flex items-center justify-between px-4 py-2 border-b'>
        <span className='text-sm font-medium'>Components</span>
        <MaterialsMenu />
      </div>

      {/* 物料列表 */}
      <div className='px-4'>
        <Accordion type='single' collapsible defaultValue={debugCategoryMap.size > 0 ? DEBUG_GROUP : undefined}>
          {/* 调试中的物料组（如果有） */}
          {debugCategoryMap.size > 0 && (
            <AccordionItem value={DEBUG_GROUP}>
              <AccordionTrigger className='text-green-600 hover:text-green-700 py-3 hover:bg-accent/30 rounded-md transition-all duration-200'>
                <span className='flex items-center gap-2'>
                  <span className='relative flex h-3 w-3'>
                    <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75' />
                    <span className='relative inline-flex rounded-full h-3 w-3 bg-green-500' />
                  </span>
                  <span className='font-semibold'>调试中</span>
                </span>
              </AccordionTrigger>
              <AccordionContent className='transition-all data-[state=closed]:animate-[accordion-up_300ms_ease-out] data-[state=open]:animate-[accordion-down_400ms_ease-out]'>
                {/* 调试组的二级分类 */}
                <Accordion type='single' collapsible className='pl-2'>
                  {Array.from(debugCategoryMap.entries()).map(([category, components]) => (
                    <AccordionItem key={category} value={category}>
                      <AccordionTrigger className='py-2 text-sm hover:bg-accent/30 rounded-md transition-all duration-200'>
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
                              <AccordionTrigger className='py-2 text-sm font-normal hover:bg-accent/30 rounded-md transition-all duration-200'>
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
                                          key={snippet.title}
                                          snippet={snippet}
                                          componentMeta={component}
                                        />
                                      ) : (
                                        <Snippet key={snippet.title} snippet={snippet} componentMeta={component} />
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
                              <RemoteSnippet key={snippet.title} snippet={snippet} componentMeta={component} />
                            ) : (
                              <Snippet key={snippet.title} snippet={snippet} componentMeta={component} />
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
      </div>
    </div>
  )
})
