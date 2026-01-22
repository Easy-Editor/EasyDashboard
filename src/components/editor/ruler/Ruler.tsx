import { memo, useCallback, useRef } from 'react'
import { type Tick, useRulerScale } from './hooks/useRulerScale'
import styles from './styles.module.css'

export interface RulerProps {
  /** 游尺方向 */
  type: 'horizontal' | 'vertical'
  /** 缩放比例 */
  scale: number
  /** 游尺长度（屏幕像素） */
  length: number
  /** 画布偏移量（屏幕像素） */
  offset: number
  /** 画布尺寸（画布像素） */
  canvasSize: number
  /** 当前鼠标位置（画布像素） */
  cursorPosition?: number
  /** 添加辅助线回调 */
  onAddGuideLine?: (position: number) => void
}

/** 游尺宽度/高度 */
export const RULER_SIZE = 22

/**
 * 游尺组件
 * 显示刻度并支持点击添加辅助线
 */
export const Ruler = memo<RulerProps>(({ type, scale, length, offset, canvasSize, cursorPosition, onAddGuideLine }) => {
  const rulerRef = useRef<HTMLDivElement>(null)
  const isHorizontal = type === 'horizontal'

  // 计算刻度
  const { ticks } = useRulerScale({
    scale,
    length,
    offset: offset / scale,
    canvasSize,
  })

  // 点击添加辅助线
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onAddGuideLine || !rulerRef.current) return

      const rect = rulerRef.current.getBoundingClientRect()
      const clickPos = isHorizontal ? e.clientX - rect.left : e.clientY - rect.top

      // 转换为画布坐标
      const canvasPos = (clickPos - offset) / scale
      onAddGuideLine(canvasPos)
    },
    [isHorizontal, offset, scale, onAddGuideLine],
  )

  // 渲染刻度
  const renderTick = (tick: Tick) => {
    // 屏幕位置
    const screenPos = tick.position * scale + offset

    // 刻度长度比例 - 从底部/右侧延伸
    const tickRatio = tick.type === 'large' ? 0.45 : tick.type === 'medium' ? 0.3 : 0.18
    const tickLength = RULER_SIZE * tickRatio

    const tickStyle: React.CSSProperties = isHorizontal
      ? {
          left: screenPos,
          height: tickLength,
          bottom: 0,
        }
      : {
          top: screenPos,
          width: tickLength,
          right: 0,
        }

    // 0 位置的标签不居中，避免被左上角遮挡
    const isZero = tick.position === 0
    const labelStyle: React.CSSProperties | undefined = isZero
      ? isHorizontal
        ? { transform: 'none', left: 2 }
        : { transform: 'rotate(-90deg)', left: 4 }
      : undefined

    return (
      <div key={tick.position} className={styles.tick} style={tickStyle} data-type={tick.type}>
        {tick.label && (
          <span className={styles.tickLabel} style={labelStyle}>
            {tick.label}
          </span>
        )}
      </div>
    )
  }

  // 渲染鼠标位置指示器
  const renderCursor = () => {
    if (cursorPosition === undefined) return null

    const screenPos = cursorPosition * scale + offset
    const cursorStyle: React.CSSProperties = isHorizontal
      ? { left: screenPos, height: '100%', width: 1 }
      : { top: screenPos, width: '100%', height: 1 }

    return <div className={styles.cursor} style={cursorStyle} />
  }

  return (
    <div
      ref={rulerRef}
      className={`${styles.ruler} ${isHorizontal ? styles.horizontal : styles.vertical}`}
      style={isHorizontal ? { width: '100%', height: RULER_SIZE } : { height: '100%', width: RULER_SIZE }}
      onClick={handleClick}
    >
      {ticks.map(renderTick)}
      {renderCursor()}
    </div>
  )
})

Ruler.displayName = 'Ruler'
