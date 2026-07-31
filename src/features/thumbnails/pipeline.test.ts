import { describe, expect, it, vi } from 'vitest'
import { ThumbnailCaptureError } from './capture'
import { runAutoThumbnailPipeline } from './pipeline'
import { type ThumbnailState, createThumbnailState } from './state'

function stateHarness() {
  let state: ThumbnailState = createThumbnailState()
  return {
    readState: () => state,
    writeState: (next: ThumbnailState) => {
      state = next
    },
    current: () => state,
  }
}

describe('runAutoThumbnailPipeline', () => {
  it('renders in an isolated host, uploads WebP, and commits only the matching draft version', async () => {
    const state = stateHarness()
    let currentVersion = 12
    const remove = vi.fn()
    const dispose = vi.fn()
    const publish = vi.fn().mockImplementation(async () => {
      currentVersion = 13
      return '/thumbnail-v12.webp'
    })

    const result = await runAutoThumbnailPipeline(
      { projectDocument: {}, draftVersion: 12 },
      {
        ...state,
        getCurrentDraftVersion: () => currentVersion,
        createHost: () => ({ element: {} as HTMLElement, remove }),
        mountPureRenderer: vi.fn().mockResolvedValue({
          captureElement: {} as Element,
          dispose,
        }),
        capture: vi.fn().mockResolvedValue(new Blob(['webp'], { type: 'image/webp' })),
        publish,
      },
    )

    expect(result).toMatchObject({ committed: false, reason: 'version-mismatch' })
    expect(state.current()).toMatchObject({
      status: 'rendering',
      requestedVersion: 12,
      capturedVersion: null,
    })
    expect(publish).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('falls back to a deterministic blueprint and surfaces the capture warning', async () => {
    const state = stateHarness()
    const warning = new ThumbnailCaptureError('canvas-security', 'Cross-origin content prevented capture')
    const publish = vi.fn().mockResolvedValue('/thumbnail-blueprint.svg')

    const result = await runAutoThumbnailPipeline(
      {
        projectDocument: {
          componentsTree: [
            {
              componentName: 'Root',
              $dashboard: { rect: { width: 1920, height: 1080 } },
              children: [],
            },
          ],
        },
        draftVersion: 2,
      },
      {
        ...state,
        getCurrentDraftVersion: () => 2,
        createHost: () => ({ element: {} as HTMLElement, remove: vi.fn() }),
        mountPureRenderer: vi.fn().mockResolvedValue({ captureElement: {} as Element }),
        capture: vi.fn().mockRejectedValue(warning),
        publish,
      },
    )

    expect(result).toMatchObject({
      committed: true,
      source: 'blueprint',
      captureWarning: warning,
    })
    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      draftVersion: 2,
      source: 'blueprint',
    })
    expect(publish.mock.calls[0]?.[0].blob.type).toBe('image/svg+xml')
    expect(state.current()).toMatchObject({
      status: 'ready',
      capturedVersion: 2,
      imageUrl: '/thumbnail-blueprint.svg',
    })
  })
})
