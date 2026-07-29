import { apiRequest, jsonBody } from '@/api/client'

export type UserSettings = {
  displayName?: string
  autosave?: boolean
}

export async function getSettings(): Promise<UserSettings> {
  const response = await apiRequest<{ settings: UserSettings }>('/api/settings')
  return response.settings
}

export async function updateSettings(settings: UserSettings): Promise<UserSettings> {
  const response = await apiRequest<{ settings: UserSettings }>('/api/settings', {
    method: 'PATCH',
    body: jsonBody(settings),
  })
  return response.settings
}
