import type { Designer } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useCallback, useEffect, useRef, useState, type FC, type ReactNode } from 'react'
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
}

/**
 * 游尺容器组件
 * 包裹画布，提供游尺和辅助线功能
 */
export const RulerWrapper: FC<RulerWrapperProps> = observer(
  ({ designer, children, scale, canvasSize, showRuler = true, showGrid = true, enablePan = true }) => {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const canvasAreaRef = useRef<HTMLDivElement>(null)
    const horizontalRulerRef = useRef<HTMLDivElement>(null)
    const verticalRulerRef = useRef<HTMLDivElement>(null)

    const [cursorPos, setCursorPos] = useState<{ x?: number; y?: number }>({})
    const [rulerDimensions, setRulerDimensions] = useState({ width: 0, height: 0 })
    const [canvasAreaSize, setCanvasAreaSize] = useState({ width: 0, height: 0 })

    // 画布平移
    const { offset, isSpacePressed, isPanning } = useCanvasPan({
      containerRef: canvasAreaRef,
      enabled: enablePan,
    })

    const canvasOrigin = {
      x: canvasAreaSize.width / 2 - (canvasSize.width * scale) / 2,
      y: canvasAreaSize.height / 2 - (canvasSize.height * scale) / 2,
    }

    // 监听游尺容器尺寸变化和 scale 变化
    useEffect(() => {
      const updateDimensions = () => {
        const hRuler = horizontalRulerRef.current
        const vRuler = verticalRulerRef.current
        const canvasArea = canvasAreaRef.current
        if (hRuler && vRuler) {
          setRulerDimensions({
            width: hRuler.offsetWidth,
            height: vRuler.offsetHeight,
          })
        }
        if (canvasArea) {
          setCanvasAreaSize({
            width: canvasArea.offsetWidth,
            height: canvasArea.offsetHeight,
          })
        }
      }

      // 初始测量
      updateDimensions()

      // 使用 ResizeObserver 监听尺寸变化
      const resizeObserver = new ResizeObserver(() => {
        updateDimensions()
      })

      if (wrapperRef.current) {
        resizeObserver.observe(wrapperRef.current)
      }
      if (canvasAreaRef.current) {
        resizeObserver.observe(canvasAreaRef.current)
      }

      return () => {
        resizeObserver.disconnect()
      }
    }, [scale])

    // 鼠标移动更新位置
    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        if (!canvasAreaRef.current) return
        const rect = canvasAreaRef.current.getBoundingClientRect()
        // 计算相对于画布原点的坐标
        const x = (e.clientX - rect.left - canvasOrigin.x - offset.x) / scale
        const y = (e.clientY - rect.top - canvasOrigin.y - offset.y) / scale
        setCursorPos({ x, y })
      },
      [canvasOrigin, offset, scale],
    )

    const handleMouseLeave = useCallback(() => {
      setCursorPos({})
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

    // 计算网格样式
    const gridStyle: React.CSSProperties = showGrid
      ? ({
          '--scale': scale,
          '--offset-x': offset.x,
          '--offset-y': offset.y,
        } as React.CSSProperties)
      : {}

    if (!showRuler) {
      return <div className={styles.canvasArea}>{children}</div>
    }

    return (
      <div ref={wrapperRef} className={styles.wrapper}>
        {/* 左上角 */}
        <div className={styles.corner} />

        {/* 水平游尺 */}
        <div ref={horizontalRulerRef} className={styles.horizontalRuler}>
          <Ruler
            type='horizontal'
            scale={scale}
            length={rulerDimensions.width}
            offset={canvasOrigin.x + offset.x}
            canvasSize={canvasSize.width}
            cursorPosition={cursorPos.x}
            onAddGuideLine={handleAddVerticalGuideLine}
          />
        </div>

        {/* 垂直游尺 */}
        <div ref={verticalRulerRef} className={styles.verticalRuler}>
          <Ruler
            type='vertical'
            scale={scale}
            length={rulerDimensions.height}
            offset={canvasOrigin.y + offset.y}
            canvasSize={canvasSize.height}
            cursorPosition={cursorPos.y}
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

          {/* 坐标显示 */}
          {cursorPos.x !== undefined && cursorPos.y !== undefined && (
            <div className={styles.coordsLabel} style={{ left: offset.x, top: offset.y }}>
              {Math.round(cursorPos.x)}, {Math.round(cursorPos.y)}
            </div>
          )}

          {/* 画布内容 */}
          {children}
        </div>
      </div>
    )
  },
)
