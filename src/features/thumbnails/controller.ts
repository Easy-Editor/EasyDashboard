import type { DraftSyncStatus } from '@/editor/persistence/draft-sync'
import type { ThumbnailMode } from './state'

export type AutoThumbnailRunDecision = { run: true; draftVersion: number } | { run: false }
export type ThumbnailRetryAction = 'retry-custom' | 'select-custom-file' | 'retry-auto'

export function decideAutoThumbnailRun(input: {
  mode: ThumbnailMode
  saveStatus: DraftSyncStatus
  draftVersion: number
  lastAttemptedVersion: number | null
  force?: boolean
}): AutoThumbnailRunDecision {
  const clean = input.saveStatus === 'idle' || input.saveStatus === 'saved'
  if (!clean || input.mode !== 'auto' || input.draftVersion < 1) return { run: false }
  if (!input.force && input.lastAttemptedVersion === input.draftVersion) return { run: false }
  return { run: true, draftVersion: input.draftVersion }
}

export function resolveThumbnailRetryAction(mode: ThumbnailMode, hasCustomFile: boolean): ThumbnailRetryAction {
  if (mode === 'auto') return 'retry-auto'
  return hasCustomFile ? 'retry-custom' : 'select-custom-file'
}
