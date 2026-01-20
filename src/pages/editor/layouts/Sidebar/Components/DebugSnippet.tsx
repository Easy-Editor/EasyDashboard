import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { project } from '@easy-editor/core'
import { useEffect, useRef, useState } from 'react'
import type { SnippetProps } from '.'

/** 调试分组名称 */
export const DEBUG_GROUP = 'DEBUG'

/**
 * 调试中物料 Snippet 组件
 * 带有特殊的视觉指示
 */
export const DebugSnippet = ({ snippet }: SnippetProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
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
