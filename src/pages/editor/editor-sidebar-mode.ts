import type { EditorMode } from '@/contexts/editor-mode-context'

export function getSidebarOpenForModeTransition(
  previousMode: EditorMode | undefined,
  mode: EditorMode,
): boolean | undefined {
  if (mode === 'code') {
    return false
  }

  if (previousMode === undefined || previousMode === 'code') {
    return true
  }

  return undefined
}
