import type { ProjectDetail, SaveDraftResponse } from '@/api/contracts'
import type { ProjectSchema } from '@easy-editor/core'

type RestoreProjectDraftOptions = {
  projectId: string
  revisionId: string
  expectedVersion: number
  restore: (projectId: string, revisionId: string, expectedVersion: number) => Promise<SaveDraftResponse>
  load: (projectId: string) => Promise<Pick<ProjectDetail<ProjectSchema>, 'schema'>>
  reloadEditor: (schema: ProjectSchema) => Promise<void>
  acceptBaseline: (version: number, savedAt: string) => void
}

export async function restoreProjectDraft(options: RestoreProjectDraftOptions) {
  const restored = await options.restore(options.projectId, options.revisionId, options.expectedVersion)
  const detail = await options.load(options.projectId)
  await options.reloadEditor(detail.schema)
  options.acceptBaseline(restored.draftVersion, restored.savedAt)
  return detail
}
