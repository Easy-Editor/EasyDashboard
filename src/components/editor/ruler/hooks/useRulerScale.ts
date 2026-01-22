import { useMemo } from 'react'

/**
 * 刻度配置
 */
interface TickConfig {
  /** 小刻度间隔（画布像素） */
  smallInterval: number
  /** 中刻度间隔（画布像素） */
  mediumInterval: number
  /** 大刻度间隔（画布像素，显示数字） */
  largeInterval: number
}

/**
 * 刻度项
 */
export interface Tick {
  /** 画布坐标位置 */
  position: number
  /** 刻度类型 */
  type: 'small' | 'medium' | 'large'
  /** 显示的标签（仅大刻度有） */
  label?: string
}

/**
 * 根据缩放比例计算合适的刻度间隔
 */
function getTickConfig(scale: number): TickConfig {
  // 根据缩放比例选择合适的刻度间隔
  // 目标：确保刻度在屏幕上的间距适中（约 5-20px）
  const baseInterval = 10
  const screenInterval = baseInterval * scale

  if (screenInterval >= 8) {
    return { smallInterval: 10, mediumInterval: 50, largeInterval: 100 }
  }
  if (screenInterval >= 4) {
    return { smallInterval: 20, mediumInterval: 100, largeInterval: 200 }
  }
  if (screenInterval >= 2) {
    return { smallInterval: 50, mediumInterval: 250, largeInterval: 500 }
  }
  return { smallInterval: 100, mediumInterval: 500, largeInterval: 1000 }
}

interface UseRulerScaleOptions {
  /** 缩放比例 */
  scale: number
  /** 游尺长度（屏幕像素） */
  length: number
  /** 画布偏移量（画布像素） */
  offset: number
  /** 画布尺寸（画布像素） */
  canvasSize: number
}

interface UseRulerScaleResult {
  /** 刻度列表 */
  ticks: Tick[]
  /** 刻度配置 */
  tickConfig: TickConfig
}

/**
 * 计算游尺刻度的 Hook
 */
export function useRulerScale(options: UseRulerScaleOptions): UseRulerScaleResult {
  const { scale, length, offset, canvasSize } = options

  return useMemo(() => {
    const tickConfig = getTickConfig(scale)
    const ticks: Tick[] = []

    // 计算可见范围（画布坐标）
    const startCanvas = -offset
    const endCanvas = startCanvas + length / scale

    // 对齐到小刻度
    const alignedStart = Math.floor(startCanvas / tickConfig.smallInterval) * tickConfig.smallInterval
    const alignedEnd = Math.ceil(endCanvas / tickConfig.smallInterval) * tickConfig.smallInterval

    // 限制范围，避免生成过多刻度
    const safeStart = Math.max(alignedStart, -1000)
    const safeEnd = Math.min(alignedEnd, canvasSize + 1000)

    for (let pos = safeStart; pos <= safeEnd; pos += tickConfig.smallInterval) {
      const isLarge = pos % tickConfig.largeInterval === 0
      const isMedium = !isLarge && pos % tickConfig.mediumInterval === 0

      ticks.push({
        position: pos,
        type: isLarge ? 'large' : isMedium ? 'medium' : 'small',
        label: isLarge ? String(pos) : undefined,
      })
    }

    return { ticks, tickConfig }
  }, [scale, length, offset, canvasSize])
}
