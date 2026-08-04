import { useAuth } from '@/auth/useAuth'
import { getSettings, updateSettings } from '@/features/settings/settings-api'
import {
  type WorkspaceRailPreference,
  publishWorkspaceRailPreference,
  readCachedWorkspaceRailPreference,
  subscribeWorkspaceRailPreference,
} from '@/features/settings/workspace-rail-preference'
import { cn } from '@/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router'
import { WorkspaceRail, type WorkspaceRailMode, getInitialWorkspaceRailMode } from './WorkspaceRail'

export function AppShell() {
  const { user } = useAuth()
  const ownerUserId = user?.id ?? null
  const [railMode, setRailMode] = useState<WorkspaceRailMode>(() => getInitialWorkspaceRailMode(ownerUserId))
  const preferenceRevisionRef = useRef(0)

  useEffect(
    () =>
      subscribeWorkspaceRailPreference(ownerUserId, preference => {
        preferenceRevisionRef.current += 1
        setRailMode(preference === 'docked' ? 'docked' : 'hidden')
      }),
    [ownerUserId],
  )

  useEffect(() => {
    const startingRevision = preferenceRevisionRef.current
    void getSettings()
      .then(settings => {
        if (!settings.workspaceRailPreference || preferenceRevisionRef.current !== startingRevision) return
        publishWorkspaceRailPreference(settings.workspaceRailPreference, ownerUserId)
      })
      .catch(() => {
        // Keep the cached legacy preference when user settings are temporarily unavailable.
      })
  }, [ownerUserId])

  const persistRailPreference = useCallback(
    async (preference: WorkspaceRailPreference) => {
      const previousPreference = readCachedWorkspaceRailPreference(ownerUserId)
      publishWorkspaceRailPreference(preference, ownerUserId)
      try {
        const settings = await updateSettings({ workspaceRailPreference: preference })
        publishWorkspaceRailPreference(settings.workspaceRailPreference ?? preference, ownerUserId)
      } catch (error) {
        publishWorkspaceRailPreference(previousPreference, ownerUserId)
        throw error
      }
    },
    [ownerUserId],
  )

  return (
    <div data-ed-shell='app' className='min-h-screen min-w-[1024px] bg-[var(--ed-canvas)] text-[var(--ed-ink)]'>
      <WorkspaceRail mode={railMode} onModeChange={setRailMode} onPreferenceChange={persistRailPreference} />
      <main
        inert={railMode === 'overlay'}
        className={cn(
          'min-h-screen transition-[padding] duration-200 ease-out',
          railMode === 'docked' ? 'pl-[216px]' : 'pl-0',
        )}
      >
        <Outlet />
      </main>
    </div>
  )
}
