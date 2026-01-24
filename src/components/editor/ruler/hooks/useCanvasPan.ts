import { project } from '@easy-editor/core'
import { useCallback, useEffect, useState, type RefObject } from 'react'

interface CanvasPanState {
  /** 画布偏移量 */
  offset: { x: number; y: number }
  /** 是否正在平移 */
  isPanning: boolean
  /** 是否按住空格键 */
  isSpacePressed: boolean
}

interface UseCanvasPanOptions {
  /** 画布容器引用 */
  containerRef: RefObject<HTMLElement | null>
  /** 是否启用平移功能 */
  enabled?: boolean
  /** 偏移量变化回调 */
  onOffsetChange?: (offset: { x: number; y: number }) => void
  /** 当前缩放比例 */
  scale?: number
  /** 缩放变化回调 */
  onScaleChange?: (scale: number) => void
  /** 最小缩放比例 */
  minScale?: number
  /** 最大缩放比例 */
  maxScale?: number
}

interface UseCanvasPanResult extends CanvasPanState {
  /** 重置偏移量 */
  resetOffset: () => void
  /** 设置偏移量 */
  setOffset: (offset: { x: number; y: number }) => void
}

/**
 * 画布平移 Hook
 * 按住空格键 + 拖动鼠标实现画布平移
 */
export function useCanvasPan(options: UseCanvasPanOptions): UseCanvasPanResult {
  const {
    containerRef,
    enabled = true,
    onOffsetChange,
    scale = 1,
    onScaleChange,
    minScale = 0.1,
    maxScale = 3,
  } = options
  const marqueeSelection = project.designer.marqueeSelection

  const [offset, setOffsetState] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [startOffset, setStartOffset] = useState({ x: 0, y: 0 })

  const setOffset = useCallback(
    (newOffset: { x: number; y: number }) => {
      setOffsetState(newOffset)
      onOffsetChange?.(newOffset)
    },
    [onOffsetChange],
  )

  const resetOffset = useCallback(() => {
    setOffset({ x: 0, y: 0 })
  }, [setOffset])

  // 空格键检测
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        setIsSpacePressed(true)
        // 拖拽画布时，禁用框选
        marqueeSelection.enabled = false
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false)
        setIsPanning(false)
        marqueeSelection.enabled = true
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [enabled])

  // 鼠标拖动处理
  useEffect(() => {
    if (!enabled || !isSpacePressed) return

    const container = containerRef.current
    if (!container) return

    const handleMouseDown = (e: MouseEvent) => {
      if (!isSpacePressed) return
      e.preventDefault()
      setIsPanning(true)
      setStartPos({ x: e.clientX, y: e.clientY })
      setStartOffset({ ...offset })
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanning) return
      const dx = e.clientX - startPos.x
      const dy = e.clientY - startPos.y
      setOffset({
        x: startOffset.x + dx,
        y: startOffset.y + dy,
      })
    }

    const handleMouseUp = () => {
      setIsPanning(false)
    }

    container.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      container.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [enabled, isSpacePressed, isPanning, startPos, startOffset, offset, setOffset, containerRef])

  // 滚轮缩放处理
  useEffect(() => {
    if (!enabled || !isSpacePressed || !onScaleChange) return

    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      // 向上滚动放大，向下滚动缩小
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      const newScale = Math.max(minScale, Math.min(maxScale, scale + delta))
      onScaleChange(newScale)
    }

    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [enabled, isSpacePressed, scale, onScaleChange, minScale, maxScale, containerRef])

  return {
    offset,
    isPanning,
    isSpacePressed,
    resetOffset,
    setOffset,
  }
}
