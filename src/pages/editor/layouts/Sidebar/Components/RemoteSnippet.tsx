/**
 * 远程物料 Snippet 组件
 * 处理远程物料的拖拽和点击添加到画布
 */

import { Card, CardContent } from '@/components/ui/card'
import { materialManager } from '@/editor/remote'
import { cn } from '@/lib/utils'
import { type ComponentMeta, type Snippet as ISnippet, project } from '@easy-editor/core'
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
  const ref = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(false)

  // 使用 MobX 响应式数据来检测组件是否已加载
  // 这样当任何 snippet 加载组件后，所有使用同一 globalName 的 snippet 都会重新渲染
  const remoteComponentsMap = materialManager.remoteComponentsMap
  const hasRemoteComponent = metadata.componentName ? !!remoteComponentsMap[metadata.componentName] : false

  const handleCanvasDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
  }, [])

  // 处理拖拽完成：在画布上监听 drop 事件
  useEffect(() => {
    const npmPackage = metadata.npm?.package
    const globalName = metadata.npm?.globalName
    const snippetTitle = snippet.title

    if (!npmPackage || !globalName) {
      return
    }

    const simulator = project.simulator
    if (!simulator) return

    const canvasElement = simulator.contentDocument?.body
    if (!canvasElement) return

    const handleCanvasDrop = async (e: DragEvent) => {
      // 检查是否是当前远程物料的拖拽
      const dragData = e.dataTransfer?.getData('text/plain')
      const expectedDragData = `remote-material:${globalName}:${snippetTitle}`

      if (dragData !== expectedDragData) return

      e.preventDefault()
      e.stopPropagation()

      setIsLoading(true)

      try {
        // 1. 加载组件代码（如果未加载）
        if (!hasRemoteComponent) {
          materialManager.addComponent(npmPackage, metadata.npm?.version)
        }

        // 2. 获取 drop 坐标
        const rect = canvasElement.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const canvasPos = simulator.viewport.toLocalPoint({ clientX: x, clientY: y })

        // 3. 创建节点 schema
        const currentDocument = project.currentDocument
        if (!currentDocument) {
          throw new Error('No active document')
        }

        const snippetRect = snippet.schema?.$dashboard?.rect
        const nodeSchema = {
          ...snippet.schema,
          componentName: snippet.schema?.componentName || metadata.componentName,
          npm: {
            package: npmPackage,
            version: metadata.npm?.version || 'latest',
            globalName: globalName,
            componentName: metadata.npm?.componentName || metadata.componentName,
          },
          $dashboard: {
            ...snippet.schema?.$dashboard,
            rect: {
              ...snippetRect,
              x: canvasPos.clientX,
              y: canvasPos.clientY,
              width: snippetRect?.width ?? 200,
              height: snippetRect?.height ?? 100,
            },
          },
        }

        // 4. 插入节点
        const rootNode = currentDocument.root
        if (rootNode) {
          const newNode = currentDocument.insertNode(rootNode, nodeSchema, 0, true)
          if (newNode) {
            newNode.select()
          }
          toast.success('远程物料已添加')
        }

        setIsLoading(false)
      } catch (error) {
        toast.error('添加组件失败', {
          description: error instanceof Error ? error.message : String(error),
        })
        setIsLoading(false)
      }
    }

    canvasElement.addEventListener('drop', handleCanvasDrop)
    canvasElement.addEventListener('dragover', handleCanvasDragOver)

    return () => {
      canvasElement.removeEventListener('drop', handleCanvasDrop)
      canvasElement.removeEventListener('dragover', handleCanvasDragOver)
    }
  }, [
    metadata.npm?.package,
    metadata.npm?.globalName,
    metadata.npm?.version,
    metadata.npm?.componentName,
    metadata.componentName,
    snippet.schema,
    snippet.title,
    hasRemoteComponent,
    handleCanvasDragOver,
  ])

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

    setIsLoading(true)

    try {
      // 1. 加载组件代码（如果未加载）
      if (!hasRemoteComponent) {
        // 修复：传入 version 参数，避免 cache key 不匹配
        await materialManager.addComponent(metadata.npm.package, metadata.npm.version)
      }

      // 2. 获取当前文档
      const currentDocument = project.currentDocument
      if (!currentDocument) {
        throw new Error('No active document')
      }

      // 3. 验证 snippet.schema
      if (!snippet.schema) {
        throw new Error('Snippet schema is missing')
      }

      // 4. 计算画布中心坐标
      const simulator = project.simulator
      const viewport = simulator?.viewport

      // 从 snippet 的 schema 中读取尺寸
      const snippetRect = snippet.schema.$dashboard?.rect
      const defaultWidth = snippetRect?.width ?? 200
      const defaultHeight = snippetRect?.height ?? 100

      let targetX = 100
      let targetY = 100

      if (viewport) {
        // 计算画布中心坐标（组件左上角位置）
        targetX = (viewport.width - defaultWidth) / 2
        targetY = (viewport.height - defaultHeight) / 2
      }

      // 5. 创建节点 schema（基于 snippet，使用画布中心坐标）
      const nodeSchema = {
        ...snippet.schema,
        componentName: snippet.schema.componentName || metadata.componentName,
        // 添加 npm 信息到 schema
        npm: {
          package: metadata.npm.package,
          version: metadata.npm.version || 'latest',
          globalName: metadata.npm.globalName,
          componentName: metadata.npm.componentName || metadata.componentName,
        },
        // 覆盖位置信息（使用画布中心）
        $dashboard: {
          ...snippet.schema.$dashboard,
          rect: {
            ...snippetRect,
            x: targetX,
            y: targetY,
            width: defaultWidth,
            height: defaultHeight,
          },
        },
      }

      // 6. 添加到画布（添加到 Root 节点）
      const rootNode = currentDocument.root
      if (rootNode) {
        const newNode = currentDocument.insertNode(rootNode, nodeSchema, 0, true)

        // 选中新添加的节点
        if (newNode) {
          newNode.select()
        }
        toast.success('远程物料已添加')
      } else {
        throw new Error('Root node not found')
      }

      setIsLoading(false)
    } catch (error) {
      toast.error('添加组件失败', {
        description: error instanceof Error ? error.message : String(error),
        position: 'top-center',
      })
      setIsLoading(false)
    }
  }

  return (
    <Card
      ref={ref}
      className={cn(
        'cursor-move select-none aspect-square hover:scale-105 transition-all duration-300',
        isLoading && 'opacity-50 cursor-wait',
      )}
      onDoubleClick={handleDoubleClick}
      onDragStart={handleDragStart}
      draggable={true}
    >
      <CardContent
        className={cn(
          snippet.screenshot ? 'justify-between' : 'justify-center',
          'flex flex-col items-center w-full h-full p-4 relative',
        )}
      >
        {snippet.screenshot && <img src={snippet.screenshot} alt={snippet.title} className='object-cover' />}
        <span className='w-full text-sm font-medium text-center overflow-hidden text-ellipsis whitespace-nowrap'>
          {snippet.title}
        </span>
        {isLoading && (
          <div className='absolute inset-0 flex items-center justify-center bg-background/50 rounded'>
            <div className='text-xs text-muted-foreground'>加载中...</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
})
