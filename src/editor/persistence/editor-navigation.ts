export type EditorNavigationLocation = {
  pathname: string
  search: string
  hash: string
}

const UNSAVED_EDITOR_STATUSES = new Set(['dirty', 'saving', 'error', 'conflict'])

function comparableSearch(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('page')
  params.sort()
  return params.toString()
}

export function isEditorPageQueryNavigation(
  currentLocation: EditorNavigationLocation,
  nextLocation: EditorNavigationLocation,
): boolean {
  return (
    currentLocation.pathname === nextLocation.pathname &&
    currentLocation.hash === nextLocation.hash &&
    comparableSearch(currentLocation.search) === comparableSearch(nextLocation.search)
  )
}

export function shouldBlockEditorNavigation(
  saveStatus: string,
  currentLocation: EditorNavigationLocation,
  nextLocation: EditorNavigationLocation,
): boolean {
  return UNSAVED_EDITOR_STATUSES.has(saveStatus) && !isEditorPageQueryNavigation(currentLocation, nextLocation)
}
