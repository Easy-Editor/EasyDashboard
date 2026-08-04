export type ProjectDraftSnapshot = {
  draftVersion: number
}

type RefreshProjectDraftOptions<Project extends ProjectDraftSnapshot> = {
  projectId: string
  loadProject: (projectId: string) => Promise<Project>
  applyProject: (project: Project) => void
  publishUpdate: (update: { projectId: string; draftVersion: number }) => void
}

export type RefreshProjectDraftResult<Project> = { ok: true; project: Project } | { ok: false; reason: unknown }

export async function refreshProjectDraftAfterMutation<Project extends ProjectDraftSnapshot>({
  projectId,
  loadProject,
  applyProject,
  publishUpdate,
}: RefreshProjectDraftOptions<Project>): Promise<RefreshProjectDraftResult<Project>> {
  try {
    const project = await loadProject(projectId)
    applyProject(project)
    publishUpdate({ projectId, draftVersion: project.draftVersion })
    return { ok: true, project }
  } catch (reason) {
    return { ok: false, reason }
  }
}
