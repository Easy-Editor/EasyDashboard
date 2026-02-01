import type { Designer } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useCanvasPan } from './hooks/useCanvasPan'
import { Ruler } from './Ruler'
import styles from './styles.module.css'

export interface RulerWrapperRef {
  /** 重置画布偏移 */
  resetOffset: () => void
  /** 自适应宽度，返回计算的 scale */
  fitWidth: () => number | undefined
}

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
export const RulerWrapper = observer(
  forwardRef<RulerWrapperRef, RulerWrapperProps>(
    (
      {
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
      },
      ref,
    ) => {
      const wrapperRef = useRef<HTMLDivElement>(null)
      const canvasAreaRef = useRef<HTMLDivElement>(null)
      const horizontalRulerRef = useRef<HTMLDivElement>(null)
      const verticalRulerRef = useRef<HTMLDivElement>(null)

      const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
      const [rulerDimensions, setRulerDimensions] = useState({ width: 0, height: 0 })
      const [canvasOrigin, setCanvasOrigin] = useState({ x: 0, y: 0 })

      // 画布平移
      const { offset, isSpacePressed, isPanning, resetOffset } = useCanvasPan({
        containerRef: canvasAreaRef,
        enabled: enablePan,
        scale,
        onScaleChange,
        minScale,
        maxScale,
      })

      // 自适应宽度计算
      const fitWidth = useCallback(() => {
        const canvasArea = canvasAreaRef.current
        if (!canvasArea || !onScaleChange) return undefined

        const availableWidth = canvasArea.clientWidth
        const newScale = availableWidth / canvasSize.width

        // 限制范围并应用
        const clampedScale = Math.min(Math.max(newScale, minScale), maxScale)
        onScaleChange(clampedScale)

        // 重置平移偏移
        resetOffset()

        return clampedScale
      }, [canvasSize.width, onScaleChange, minScale, maxScale, resetOffset])

      // 暴露方法给父组件
      useImperativeHandle(
        ref,
        () => ({
          resetOffset,
          fitWidth,
        }),
        [resetOffset, fitWidth],
      )

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

      // 更新画布原点位置（根据容器尺寸、画布尺寸和缩放计算）
      const updateCanvasOrigin = useCallback(() => {
        const container = canvasAreaRef.current
        if (!container) return

        const containerWidth = container.clientWidth
        const containerHeight = container.clientHeight

        // 画布居中：原点位置 = (容器尺寸 - 画布尺寸 × 缩放) / 2
        setCanvasOrigin({
          x: (containerWidth - canvasSize.width * scale) / 2,
          y: (containerHeight - canvasSize.height * scale) / 2,
        })
      }, [canvasSize.width, canvasSize.height, scale])

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
  ),
)
