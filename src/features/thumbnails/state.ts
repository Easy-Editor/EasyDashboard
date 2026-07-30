export type ThumbnailMode = 'auto' | 'custom'
export type ThumbnailStatus = 'queued' | 'rendering' | 'ready' | 'failed'

export type ThumbnailState = {
  mode: ThumbnailMode
  status: ThumbnailStatus
  requestedVersion: number | null
  capturedVersion: number | null
  imageUrl: string | null
  lastGoodUrl: string | null
  error: string | null
}

type ThumbnailStateSeed = {
  mode?: ThumbnailMode
  imageUrl?: string | null
  capturedVersion?: number | null
}

export function createThumbnailState(seed: ThumbnailStateSeed = {}): ThumbnailState {
  const imageUrl = seed.imageUrl ?? null
  return {
    mode: seed.mode ?? 'auto',
    status: imageUrl ? 'ready' : 'queued',
    requestedVersion: null,
    capturedVersion: seed.capturedVersion ?? null,
    imageUrl,
    lastGoodUrl: imageUrl,
    error: null,
  }
}

export function queueAutoThumbnail(state: ThumbnailState, draftVersion: number): ThumbnailState {
  return {
    ...state,
    mode: 'auto',
    status: 'queued',
    requestedVersion: draftVersion,
    error: null,
  }
}

export function startAutoThumbnailRender(state: ThumbnailState, draftVersion: number): ThumbnailState {
  if (state.mode !== 'auto' || state.requestedVersion !== draftVersion) return state
  return {
    ...state,
    status: 'rendering',
    error: null,
  }
}

export function commitAutoThumbnail(state: ThumbnailState, draftVersion: number, imageUrl: string): ThumbnailState {
  if (state.mode !== 'auto' || state.status !== 'rendering' || state.requestedVersion !== draftVersion) {
    return state
  }

  return {
    ...state,
    status: 'ready',
    capturedVersion: draftVersion,
    imageUrl,
    lastGoodUrl: imageUrl,
    error: null,
  }
}

export function failAutoThumbnail(state: ThumbnailState, draftVersion: number, error: string): ThumbnailState {
  if (state.mode !== 'auto' || state.requestedVersion !== draftVersion) return state
  return {
    ...state,
    status: 'failed',
    imageUrl: state.lastGoodUrl,
    error,
  }
}

export function setCustomThumbnail(state: ThumbnailState, imageUrl: string): ThumbnailState {
  return {
    ...state,
    mode: 'custom',
    status: 'ready',
    requestedVersion: null,
    capturedVersion: null,
    imageUrl,
    lastGoodUrl: imageUrl,
    error: null,
  }
}
