import { ThumbnailCaptureError, type ThumbnailCaptureOptions, captureElementToWebp } from './capture'
import {
  type ThumbnailState,
  commitAutoThumbnail,
  failAutoThumbnail,
  queueAutoThumbnail,
  startAutoThumbnailRender,
} from './state'
import { generateViewportBlueprint } from './viewport-blueprint'

export type ThumbnailArtifactSource = 'renderer' | 'blueprint'

export type ThumbnailPublishRequest = {
  blob: Blob
  draftVersion: number
  source: ThumbnailArtifactSource
  width: 960
  height: 540
}

export type PureRendererMount = {
  captureElement: Element
  dispose?: () => void | Promise<void>
}

export type ThumbnailHost = {
  element: HTMLElement
  remove(): void
}

export type AutoThumbnailPipelineDependencies = {
  readState(): ThumbnailState
  writeState(state: ThumbnailState): void
  getCurrentDraftVersion(): number
  mountPureRenderer(container: HTMLElement, projectDocument: unknown): Promise<PureRendererMount> | PureRendererMount
  publish(request: ThumbnailPublishRequest): Promise<string>
  createHost?: () => ThumbnailHost
  capture?: (element: Element, options?: ThumbnailCaptureOptions) => Promise<Blob>
}

export type AutoThumbnailPipelineResult =
  | {
      committed: true
      source: ThumbnailArtifactSource
      imageUrl: string
      captureWarning?: ThumbnailCaptureError
    }
  | {
      committed: false
      reason: 'version-mismatch' | 'state-changed' | 'publish-failed'
      source?: ThumbnailArtifactSource
      captureWarning?: ThumbnailCaptureError
      error?: Error
    }

function createOffscreenHost(): ThumbnailHost {
  const element = document.createElement('div')
  element.dataset.thumbnailCaptureHost = ''
  Object.assign(element.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: '1920px',
    height: '1080px',
    overflow: 'hidden',
    pointerEvents: 'none',
    contain: 'layout paint style',
  })
  document.body.append(element)
  return {
    element,
    remove: () => element.remove(),
  }
}

function captureError(error: unknown): ThumbnailCaptureError {
  return error instanceof ThumbnailCaptureError
    ? error
    : new ThumbnailCaptureError('svg-render', 'PureRenderer thumbnail capture failed', {
        cause: error,
      })
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Client-only orchestration seam. The caller supplies the PureRenderer mount
 * and publish adapter (for example, a signed-upload endpoint), while this
 * function owns isolation, fallback, cleanup, and draft-version commit guards.
 */
export async function runAutoThumbnailPipeline(
  input: { projectDocument: unknown; draftVersion: number },
  dependencies: AutoThumbnailPipelineDependencies,
): Promise<AutoThumbnailPipelineResult> {
  if (dependencies.getCurrentDraftVersion() !== input.draftVersion) {
    return { committed: false, reason: 'version-mismatch' }
  }

  dependencies.writeState(queueAutoThumbnail(dependencies.readState(), input.draftVersion))
  dependencies.writeState(startAutoThumbnailRender(dependencies.readState(), input.draftVersion))

  const host = (dependencies.createHost ?? createOffscreenHost)()
  let mount: PureRendererMount | undefined
  let source: ThumbnailArtifactSource = 'renderer'
  let artifact: Blob
  let captureWarning: ThumbnailCaptureError | undefined

  try {
    try {
      mount = await dependencies.mountPureRenderer(host.element, input.projectDocument)
      artifact = await (dependencies.capture ?? captureElementToWebp)(mount.captureElement)
    } catch (error) {
      source = 'blueprint'
      captureWarning = captureError(error)
      const blueprint = generateViewportBlueprint(input.projectDocument)
      artifact = new Blob([blueprint.svg], { type: 'image/svg+xml' })
    }
  } finally {
    try {
      await mount?.dispose?.()
    } catch (error) {
      captureWarning ??= captureError(error)
    } finally {
      host.remove()
    }
  }

  if (dependencies.getCurrentDraftVersion() !== input.draftVersion) {
    return { committed: false, reason: 'version-mismatch', source, captureWarning }
  }

  let imageUrl: string
  try {
    imageUrl = await dependencies.publish({
      blob: artifact,
      draftVersion: input.draftVersion,
      source,
      width: 960,
      height: 540,
    })
  } catch (error) {
    const publishError = asError(error)
    dependencies.writeState(failAutoThumbnail(dependencies.readState(), input.draftVersion, publishError.message))
    return {
      committed: false,
      reason: 'publish-failed',
      source,
      captureWarning,
      error: publishError,
    }
  }

  if (dependencies.getCurrentDraftVersion() !== input.draftVersion) {
    return { committed: false, reason: 'version-mismatch', source, captureWarning }
  }

  const current = dependencies.readState()
  const committed = commitAutoThumbnail(current, input.draftVersion, imageUrl)
  if (committed === current) {
    return { committed: false, reason: 'state-changed', source, captureWarning }
  }
  dependencies.writeState(committed)

  return {
    committed: true,
    source,
    imageUrl,
    ...(captureWarning ? { captureWarning } : {}),
  }
}
