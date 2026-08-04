export const PROJECT_DRAFT_CHANNEL = 'easy-dashboard:project-draft-updates'

export type ProjectDraftUpdate = {
  projectId: string
  draftVersion: number
}

function isProjectDraftUpdate(value: unknown): value is ProjectDraftUpdate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProjectDraftUpdate>
  return typeof candidate.projectId === 'string' && Number.isInteger(candidate.draftVersion)
}

export function publishProjectDraftUpdate(update: ProjectDraftUpdate): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(PROJECT_DRAFT_CHANNEL)
  channel.postMessage(update)
  channel.close()
}

export function subscribeProjectDraftUpdates(
  projectId: string,
  listener: (update: ProjectDraftUpdate) => void,
): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined

  const channel = new BroadcastChannel(PROJECT_DRAFT_CHANNEL)
  channel.onmessage = event => {
    if (isProjectDraftUpdate(event.data) && event.data.projectId === projectId) listener(event.data)
  }
  return () => channel.close()
}
