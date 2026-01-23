import type { Designer } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FC, type ReactNode } from 'react'
import { useCanvasPan } from './hooks/useCanvasPan'
import { Ruler } from './Ruler'
import styles from './styles.module.css'

export interface RulerWrapperProps {
  /** 设计器实例 */
  designer: Designer
  children: ReactNode
  /** 缩放比例 */
  scale: number
  /** 画布尺寸（画布像素） */
  canvasSize: { width: number; height: number }
  /** 是否显示游尺 */
  showRuler?: boolean
  /** 是否显示网格 */
  showGrid?: boolean
  /** 是否启用平移 */
  enablePan?: boolean
  /** 缩放变化回调 */
  onScaleChange?: (scale: number) => void
  /** 最小缩放比例 */
  minScale?: number
  /** 最大缩放比例 */
  maxScale?: number
}

/**
 * 游尺容器组件
 * 包裹画布，提供游尺和辅助线功能
 */
export const RulerWrapper: FC<RulerWrapperProps> = observer(
  ({
    designer,
    children,
    scale,
    canvasSize,
    showRuler = true,
    showGrid = true,
    enablePan = true,
    onScaleChange,
    minScale = 0.1,
    maxScale = 3,
  }) => {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const canvasAreaRef = useRef<HTMLDivElement>(null)
    const horizontalRulerRef = useRef<HTMLDivElement>(null)
    const verticalRulerRef = useRef<HTMLDivElement>(null)

    const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
    const [rulerDimensions, setRulerDimensions] = useState({ width: 0, height: 0 })
    const [canvasOrigin, setCanvasOrigin] = useState({ x: 0, y: 0 })

    // 画布平移
    const { offset, isSpacePressed, isPanning } = useCanvasPan({
      containerRef: canvasAreaRef,
      enabled: enablePan,
      scale,
      onScaleChange,
      minScale,
      maxScale,
    })

    // 更新游尺尺寸
    const updateRulerDimensions = useCallback(() => {
      const hRuler = horizontalRulerRef.current
      const vRuler = verticalRulerRef.current
      if (!hRuler || !vRuler) return

      setRulerDimensions({
        width: hRuler.offsetWidth,
        height: vRuler.offsetHeight,
      })
    }, [])

    // 更新画布原点位置（通过 DOM 查询获取准确位置）
    const updateCanvasOrigin = useCallback(() => {
      const container = canvasAreaRef.current
      if (!container) return

      const viewport = container.querySelector('.lc-simulator-canvas-viewport')
      if (!viewport) return

      const viewportRect = viewport.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      setCanvasOrigin({
        x: viewportRect.left - containerRect.left,
        y: viewportRect.top - containerRect.top,
      })
    }, [])

    // 监听容器尺寸变化
    useLayoutEffect(() => {
      const wrapper = wrapperRef.current
      const canvasArea = canvasAreaRef.current
      if (!wrapper || !canvasArea) return

      updateRulerDimensions()
      updateCanvasOrigin()

      const resizeObserver = new ResizeObserver(() => {
        updateRulerDimensions()
        updateCanvasOrigin()
      })
      resizeObserver.observe(wrapper)
      resizeObserver.observe(canvasArea)

      return () => resizeObserver.disconnect()
    }, [updateRulerDimensions, updateCanvasOrigin])

    // 监听 viewport 元素变化
    useEffect(() => {
      const container = canvasAreaRef.current
      if (!container) return

      const mutationObserver = new MutationObserver(updateCanvasOrigin)
      mutationObserver.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      })

      return () => mutationObserver.disconnect()
    }, [updateCanvasOrigin])

    // 监听 scale 变化
    useEffect(() => {
      updateCanvasOrigin()
    }, [scale, updateCanvasOrigin])

    // 鼠标移动更新坐标
    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        const container = canvasAreaRef.current
        if (!container) return

        const rect = container.getBoundingClientRect()
        const x = (e.clientX - rect.left - canvasOrigin.x) / scale
        const y = (e.clientY - rect.top - canvasOrigin.y) / scale
        setCursorPos({ x, y })
      },
      [canvasOrigin, scale],
    )

    const handleMouseLeave = useCallback(() => {
      setCursorPos(null)
    }, [])

    // 添加辅助线
    const handleAddHorizontalGuideLine = useCallback(
      (position: number) => {
        designer.guideline.addUserGuideLine('horizontal', position)
      },
      [designer],
    )

    const handleAddVerticalGuideLine = useCallback(
      (position: number) => {
        designer.guideline.addUserGuideLine('vertical', position)
      },
      [designer],
    )

    // 网格样式
    const gridStyle: React.CSSProperties = showGrid
      ? ({
          '--scale': scale,
          '--offset-x': canvasOrigin.x,
          '--offset-y': canvasOrigin.y,
        } as React.CSSProperties)
      : {}

    if (!showRuler) {
      return <div className={styles.canvasArea}>{children}</div>
    }

    return (
      <div ref={wrapperRef} className={styles.wrapper}>
        {/* 左上角 + 坐标显示 */}
        <div className={styles.corner}>
          {cursorPos && (
            <span className={styles.coordsLabel}>
              {Math.round(cursorPos.x)}, {Math.round(cursorPos.y)}
            </span>
          )}
        </div>

        {/* 水平游尺 */}
        <div ref={horizontalRulerRef} className={styles.horizontalRuler}>
          <Ruler
            type='horizontal'
            scale={scale}
            length={rulerDimensions.width}
            offset={canvasOrigin.x}
            canvasSize={canvasSize.width}
            cursorPosition={cursorPos?.x}
            onAddGuideLine={handleAddVerticalGuideLine}
          />
        </div>

        {/* 垂直游尺 */}
        <div ref={verticalRulerRef} className={styles.verticalRuler}>
          <Ruler
            type='vertical'
            scale={scale}
            length={rulerDimensions.height}
            offset={canvasOrigin.y}
            canvasSize={canvasSize.height}
            cursorPosition={cursorPos?.y}
            onAddGuideLine={handleAddHorizontalGuideLine}
          />
        </div>

        {/* 画布区域 */}
        <div
          ref={canvasAreaRef}
          className={`${styles.canvasArea} ${isSpacePressed ? styles.panMode : ''} ${isPanning ? styles.panning : ''}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* 网格背景 */}
          {showGrid && <div className={styles.canvasGrid} style={gridStyle} />}

          {/* 画布内容 */}
          <div className={styles.canvasContent} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
            {children}
          </div>
        </div>
      </div>
    )
  },
)
