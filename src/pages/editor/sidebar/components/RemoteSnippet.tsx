/**
 * 远程物料 Snippet 组件
 * 处理远程物料的拖拽和点击添加到画布
 */

import { Card, CardContent } from '@/components/ui/card'
import { materialManager } from '@/editor/remote'
import { cn } from '@/lib/utils'
import { type ComponentMeta, type Snippet as ISnippet, type Point, project } from '@easy-editor/core'
import { observer } from 'mobx-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

interface RemoteSnippetProps {
  snippet: ISnippet
  componentMeta: ComponentMeta
}

/**
 * 远程物料 Snippet 组件
 */
export const RemoteSnippet = observer(({ snippet, componentMeta }: RemoteSnippetProps) => {
  const metadata = componentMeta.getMetadata()
  const componentName = metadata.componentName
  const npmPackage = metadata.npm?.package
  const npmVersion = metadata.npm?.version
  const npmGlobalName = metadata.npm?.globalName
  const npmComponentName = metadata.npm?.componentName
  const snippetSchema = snippet.schema
  const snippetTitle = snippet.title
  const ref = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(false)

  // 使用 MobX 响应式数据来检测组件是否已加载
  const remoteComponentsMap = materialManager.remoteComponentsMap
  const hasRemoteComponent = componentName ? !!remoteComponentsMap[componentName] : false

  // 添加 Snippet 到画布上
  const addSnippetToCanvas = useCallback(
    async (_pos?: Point) => {
      if (!npmPackage || !npmGlobalName) {
        return
      }

      setIsLoading(true)

      try {
        // 1. 加载组件代码（如果未加载）
        if (!hasRemoteComponent) {
          // 修复：传入 version 参数，避免 cache key 不匹配
          await materialManager.addComponent(npmPackage, npmVersion)
        }

        // 2. 获取当前文档
        const currentDocument = project.currentDocument
        if (!currentDocument) {
          throw new Error('No active document')
        }

        // 3. 验证 snippet.schema
        if (!snippetSchema) {
          throw new Error('Snippet schema is missing')
        }

        // 4. 如果提供坐标，则用 pos，否则放置在画布中心
        let pos = _pos
        if (!pos) {
          const simulator = project.simulator
          const viewport = simulator?.viewport

          // 从 snippet 的 schema 中读取尺寸
          const snippetRect = snippetSchema.$dashboard?.rect
          const defaultWidth = snippetRect?.width ?? 200
          const defaultHeight = snippetRect?.height ?? 100

          let targetX = 100
          let targetY = 100

          if (viewport) {
            // 计算画布中心坐标（组件左上角位置）
            targetX = (viewport.width - defaultWidth) / 2
            targetY = (viewport.height - defaultHeight) / 2
          }
          pos = {
            clientX: targetX,
            clientY: targetY,
          }
        }

        // 5. 创建节点 schema（基于 snippet，使用画布中心坐标）
        const snippetRect = snippetSchema.$dashboard?.rect
        const nodeSchema = {
          ...snippetSchema,
          componentName: snippetSchema.componentName || componentName,
          // 添加 npm 信息到 schema
          npm: {
            package: npmPackage,
            version: npmVersion || 'latest',
            globalName: npmGlobalName,
            componentName: npmComponentName || componentName,
          },
          // 覆盖位置信息
          $dashboard: {
            ...snippetSchema.$dashboard,
            rect: {
              ...snippetRect,
              x: pos.clientX,
              y: pos.clientY,
              width: snippetRect?.width ?? 200,
              height: snippetRect?.height ?? 100,
            },
          },
        }

        // 6. 添加到画布（添加到 Root 节点）
        const rootNode = currentDocument.root
        if (rootNode) {
          const newNode = currentDocument.insertNode(rootNode, nodeSchema, -1)
          // 选中新添加的节点
          if (newNode) {
            newNode.select()
          }
        } else {
          throw new Error('Root node not found')
        }
      } catch (error) {
        toast.error('添加组件失败', {
          description: error instanceof Error ? error.message : String(error),
          position: 'top-center',
        })
      } finally {
        setIsLoading(false)
      }
    },
    [componentName, hasRemoteComponent, npmComponentName, npmGlobalName, npmPackage, npmVersion, snippetSchema],
  )

  const handleCanvasDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
  }, [])

  // 处理拖拽完成：在画布上监听 drop 事件
  useEffect(() => {
    if (!npmPackage || !npmGlobalName) {
      return
    }

    const simulator = project.simulator
    if (!simulator) return

    const canvasElement = simulator.contentDocument?.body
    if (!canvasElement) return

    const handleCanvasDrop = async (e: DragEvent) => {
      // 检查是否是当前远程物料的拖拽
      const dragData = e.dataTransfer?.getData('text/plain')
      const expectedDragData = `remote-material:${npmGlobalName}:${snippetTitle}`

      if (dragData !== expectedDragData) return

      e.preventDefault()
      e.stopPropagation()

      // 获取 drop 坐标
      const rect = canvasElement.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const canvasPos = simulator.viewport.toLocalPoint({ clientX: x, clientY: y })

      await addSnippetToCanvas(canvasPos)
    }

    canvasElement.addEventListener('drop', handleCanvasDrop)
    canvasElement.addEventListener('dragover', handleCanvasDragOver)

    return () => {
      canvasElement.removeEventListener('drop', handleCanvasDrop)
      canvasElement.removeEventListener('dragover', handleCanvasDragOver)
    }
  }, [npmPackage, npmGlobalName, snippetTitle, addSnippetToCanvas, handleCanvasDragOver])

  // 处理拖拽开始：设置拖拽数据
  const handleDragStart = (e: React.DragEvent) => {
    if (metadata.npm?.globalName) {
      e.dataTransfer.setData('text/plain', `remote-material:${metadata.npm.globalName}:${snippet.title}`)
      e.dataTransfer.effectAllowed = 'copy'
    }
  }

  // 处理点击添加到画布中心
  const handleDoubleClick = async () => {
    if (!metadata.npm?.package) {
      return
    }

    if (isLoading) return

    await addSnippetToCanvas()
  }

  return (
    <Card
      ref={ref}
      aria-label={`Drag ${snippet.title} to canvas (Remote)`}
      tabIndex={0}
      className={cn(
        'group relative overflow-hidden cursor-move select-none aspect-square',
        'border border-blue-500/40 bg-card/60 backdrop-blur-sm',
        'transition-all duration-200 ease-out',
        'hover:bg-card hover:border-blue-500/60 hover:shadow-md hover:scale-[1.02]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
        'active:scale-[0.98]',
        isLoading && 'opacity-50 cursor-wait',
      )}
      onDoubleClick={handleDoubleClick}
      onDragStart={handleDragStart}
      draggable={true}
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
        {isLoading && (
          <div className='absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg'>
            <div className='text-xs text-muted-foreground'>Loading...</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
})
