import { describe, expect, it, vi } from 'vitest'
import {
  type GlobeWebGLDrawOptions,
  type GlobeWebGLRenderer,
  createGlobeWebGLRenderer,
  createGlobeWebGLRendererLifecycle,
} from './webgl'

class FakeCanvas {
  private readonly listeners = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string) {
    const event = { preventDefault: vi.fn(), type } as unknown as Event
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return event
  }
}

describe('GlobeScene WebGL renderer', () => {
  it('returns a safe fallback signal when WebGL is unavailable', () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement
    const image = {} as TexImageSource

    expect(createGlobeWebGLRenderer(canvas, image)).toBeNull()
  })

  it('rebuilds and redraws after a lost WebGL context is restored', () => {
    const canvas = new FakeCanvas()
    const modes: string[] = []
    const drawOptions: GlobeWebGLDrawOptions = {
      ambientLight: 0.16,
      atmosphereColor: '#6bdcff',
      centerLatitude: 18,
      centerLongitude: 118,
      daylightIntensity: 0.92,
      landColor: '#173f69',
      lightAzimuth: 35,
      oceanColor: '#04162c',
      surfaceBrightness: 0.72,
    }
    const renderers: GlobeWebGLRenderer[] = Array.from({ length: 2 }, () => ({
      dispose: vi.fn(),
      draw: vi.fn(),
    }))
    const rendererFactory = vi.fn().mockReturnValueOnce(renderers[0]).mockReturnValueOnce(renderers[1])
    const lifecycle = createGlobeWebGLRendererLifecycle(
      canvas as unknown as HTMLCanvasElement,
      {} as TexImageSource,
      mode => modes.push(mode),
      rendererFactory,
    )

    lifecycle.draw(drawOptions)
    const lostEvent = canvas.dispatch('webglcontextlost')
    canvas.dispatch('webglcontextrestored')

    expect(lostEvent.preventDefault).toHaveBeenCalledOnce()
    expect(rendererFactory).toHaveBeenCalledTimes(2)
    expect(modes).toEqual(['ready', 'fallback', 'ready'])
    expect(renderers[0]?.draw).toHaveBeenCalledWith(drawOptions)
    expect(renderers[1]?.draw).toHaveBeenCalledWith(drawOptions)

    lifecycle.dispose()
    canvas.dispatch('webglcontextrestored')
    expect(renderers[1]?.dispose).toHaveBeenCalledOnce()
    expect(rendererFactory).toHaveBeenCalledTimes(2)
  })
})
