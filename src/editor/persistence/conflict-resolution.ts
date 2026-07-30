import type { DraftSyncStatus } from './draft-sync'

export type BlockedNavigationAction = 'flush' | 'resolve-conflict'

export function getBlockedNavigationAction(status: DraftSyncStatus): BlockedNavigationAction {
  return status === 'conflict' ? 'resolve-conflict' : 'flush'
}

export function buildLocalDraftExport<TSchema>(
  schema: TSchema,
  projectName: string,
  now = new Date(),
): { filename: string; content: string } {
  const safeName =
    projectName
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  const timestamp = now.toISOString().replace(/\D/g, '').slice(0, 14)
  return {
    filename: `${safeName}-local-draft-${timestamp.slice(0, 8)}-${timestamp.slice(8)}.json`,
    content: JSON.stringify(schema, null, 2),
  }
}
