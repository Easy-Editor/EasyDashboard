import { describe, expect, it, vi } from 'vitest'
import { type AnimationFrameScheduler, waitForRendererFrames } from './render-readiness'

function controlledScheduler() {
  const frames = new Map<number, FrameRequestCallback>()
  const timers = new Map<number, () => void>()
  let nextHandle = 1

  const scheduler: AnimationFrameScheduler = {
    requestFrame: callback => {
      const handle = nextHandle++
      frames.set(handle, callback)
      return handle
    },
    cancelFrame: handle => {
      frames.delete(handle)
    },
    setTimer: callback => {
      const handle = nextHandle++
      timers.set(handle, callback)
      return handle
    },
    clearTimer: handle => {
      timers.delete(handle)
    },
  }

  return {
    scheduler,
    runFrame() {
      const [entry] = frames.entries()
      if (!entry) throw new Error('No pending animation frame')
      const [handle, callback] = entry
      frames.delete(handle)
      callback(0)
    },
    runTimer() {
      const [entry] = timers.entries()
      if (!entry) throw new Error('No pending timer')
      const [handle, callback] = entry
      timers.delete(handle)
      callback()
    },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
  }
}

describe('waitForRendererFrames', () => {
  it('waits for the requested paint frames and clears its timeout', async () => {
    const runtime = controlledScheduler()
    const promise = waitForRendererFrames(2, 2_000, runtime.scheduler)

    runtime.runFrame()
    expect(runtime.pendingFrames()).toBe(1)
    runtime.runFrame()

    await expect(promise).resolves.toBeUndefined()
    expect(runtime.pendingFrames()).toBe(0)
    expect(runtime.pendingTimers()).toBe(0)
  })

  it('rejects and cancels a pending frame when rendering stalls', async () => {
    const runtime = controlledScheduler()
    const cancelSpy = vi.spyOn(runtime.scheduler, 'cancelFrame')
    const promise = waitForRendererFrames(2, 2_000, runtime.scheduler)

    runtime.runTimer()

    await expect(promise).rejects.toThrow('缩略图渲染超时')
    expect(cancelSpy).toHaveBeenCalledOnce()
    expect(runtime.pendingFrames()).toBe(0)
    expect(runtime.pendingTimers()).toBe(0)
  })
})
