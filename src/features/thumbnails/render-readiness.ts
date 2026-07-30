export type AnimationFrameScheduler = {
  requestFrame(callback: FrameRequestCallback): number
  cancelFrame(handle: number): void
  setTimer(callback: () => void, delay: number): number
  clearTimer(handle: number): void
}

const browserAnimationFrameScheduler: AnimationFrameScheduler = {
  requestFrame: callback => window.requestAnimationFrame(callback),
  cancelFrame: handle => window.cancelAnimationFrame(handle),
  setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: handle => window.clearTimeout(handle),
}

export function waitForRendererFrames(
  frameCount = 2,
  timeoutMs = 2_000,
  scheduler: AnimationFrameScheduler = browserAnimationFrameScheduler,
): Promise<void> {
  if (frameCount <= 0) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let remaining = frameCount
    let frameHandle: number | null = null
    let timerHandle: number | null = null
    let settled = false

    const finish = (result: 'ready' | 'timeout') => {
      if (settled) return
      settled = true
      if (timerHandle !== null) scheduler.clearTimer(timerHandle)
      if (frameHandle !== null) scheduler.cancelFrame(frameHandle)
      if (result === 'ready') resolve()
      else reject(new Error('缩略图渲染超时'))
    }

    const onFrame: FrameRequestCallback = () => {
      frameHandle = null
      remaining -= 1
      if (remaining === 0) {
        finish('ready')
        return
      }
      frameHandle = scheduler.requestFrame(onFrame)
    }

    timerHandle = scheduler.setTimer(() => finish('timeout'), timeoutMs)
    frameHandle = scheduler.requestFrame(onFrame)
  })
}
