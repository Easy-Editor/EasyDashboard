export type WorkspaceRailPreference = 'docked' | 'collapsed'

export const WORKSPACE_RAIL_STORAGE_KEY = 'easy-dashboard-workspace-rail'
export const WORKSPACE_RAIL_PREFERENCE_EVENT = 'easy-dashboard:workspace-rail-preference'

type WorkspaceRailPreferenceEventDetail = {
  ownerUserId: string | null
  preference: WorkspaceRailPreference
}

function parseWorkspaceRailPreference(value: unknown): WorkspaceRailPreference | null {
  return value === 'docked' || value === 'collapsed' ? value : null
}

function storageKey(ownerUserId?: string | null): string {
  return ownerUserId ? `${WORKSPACE_RAIL_STORAGE_KEY}:${ownerUserId}` : WORKSPACE_RAIL_STORAGE_KEY
}

export function readCachedWorkspaceRailPreference(ownerUserId?: string | null): WorkspaceRailPreference {
  if (typeof window === 'undefined') return 'collapsed'
  try {
    const userPreference = parseWorkspaceRailPreference(window.localStorage.getItem(storageKey(ownerUserId)))
    if (userPreference) return userPreference

    if (ownerUserId) {
      const legacyPreference = parseWorkspaceRailPreference(window.localStorage.getItem(WORKSPACE_RAIL_STORAGE_KEY))
      if (legacyPreference) {
        window.localStorage.setItem(storageKey(ownerUserId), legacyPreference)
        window.localStorage.removeItem(WORKSPACE_RAIL_STORAGE_KEY)
        return legacyPreference
      }
    }
    return 'collapsed'
  } catch {
    return 'collapsed'
  }
}

export function publishWorkspaceRailPreference(preference: WorkspaceRailPreference, ownerUserId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(ownerUserId), preference)
  } catch {
    // The server preference still applies for this session when browser storage is unavailable.
  }
  window.dispatchEvent(
    new CustomEvent<WorkspaceRailPreferenceEventDetail>(WORKSPACE_RAIL_PREFERENCE_EVENT, {
      detail: { ownerUserId: ownerUserId ?? null, preference },
    }),
  )
}

export function subscribeWorkspaceRailPreference(
  ownerUserId: string | null | undefined,
  listener: (preference: WorkspaceRailPreference) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined

  function handlePreference(event: Event) {
    const detail = (event as CustomEvent<Partial<WorkspaceRailPreferenceEventDetail>>).detail
    const preference = parseWorkspaceRailPreference(detail?.preference)
    if (preference && (detail.ownerUserId ?? null) === (ownerUserId ?? null)) listener(preference)
  }

  window.addEventListener(WORKSPACE_RAIL_PREFERENCE_EVENT, handlePreference)
  return () => window.removeEventListener(WORKSPACE_RAIL_PREFERENCE_EVENT, handlePreference)
}
