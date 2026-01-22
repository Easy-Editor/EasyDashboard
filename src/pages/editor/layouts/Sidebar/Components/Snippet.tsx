import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { type ComponentMeta, type Snippet as ISnippet, project } from '@easy-editor/core'
import { useEffect, useRef, useState } from 'react'

export interface SnippetProps {
  snippet: ISnippet
  componentMeta: ComponentMeta
}

/**
 * 本地物料 Snippet 组件
 */
export const Snippet = ({ snippet }: SnippetProps) => {
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
      aria-label={`Drag ${snippet.title} to canvas`}
      tabIndex={0}
      className={cn(
        'group relative overflow-hidden cursor-move select-none aspect-square',
        'border border-border/40 bg-card/60 backdrop-blur-sm',
        'transition-all duration-200 ease-out',
        'hover:bg-card hover:border-border/60 hover:shadow-md hover:scale-[1.02]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        'active:scale-[0.98]',
        isDragging && 'opacity-40 scale-95 shadow-none',
      )}
    >
      <CardContent className='relative flex flex-col items-center justify-between w-full h-full p-2.5 gap-1.5'>
        {snippet.screenshot ? (
          <div className='flex-1 w-full flex items-center justify-center rounded-md overflow-hidden bg-muted/30'>
            <img
              src={snippet.screenshot}
              alt={`Preview of ${snippet.title}`}
              className='w-full h-full object-contain transition-transform duration-200 group-hover:scale-105'
              loading='lazy'
            />
          </div>
        ) : (
          <div className='flex-1 w-full flex items-center justify-center rounded-md bg-muted/30'>
            <span className='text-muted-foreground/50 text-xs'>No preview</span>
          </div>
        )}
        <span
          className={cn(
            'w-full text-xs font-medium text-center line-clamp-1',
            'text-muted-foreground group-hover:text-foreground',
            'transition-colors duration-150',
          )}
        >
          {snippet.title}
        </span>
      </CardContent>
    </Card>
  )
}
