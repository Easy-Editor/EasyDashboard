import type { Pool } from 'pg'
import type { Repository } from '../types.js'

type CreateTaskRunInput = Parameters<NonNullable<Repository['createAgentTaskRun']>>[1]

export async function ensureAgentTaskWorkspace(
  admin: Pool,
  actorId: string,
  input: Pick<CreateTaskRunInput, 'projectId' | 'conversationId' | 'taskId' | 'now'>,
  taskRunId?: string,
) {
  const current = await admin.query<{ payload: Record<string, unknown>; revision: number }>(
    'select payload, revision from app.agent_workspaces where owner_id=$1 and project_id=$2',
    [actorId, input.projectId],
  )
  const createdAt = input.now.toISOString()
  const task = {
    id: input.taskId,
    title: 'Agent task fixture',
    ...(taskRunId ? { taskRunId } : {}),
    createdAt,
    updatedAt: createdAt,
  }
  if (!current.rows[0]) {
    await admin.query(
      `insert into app.agent_workspaces (owner_id, project_id, revision, payload)
       values ($1, $2, 1, $3::jsonb)`,
      [
        actorId,
        input.projectId,
        JSON.stringify({
          version: 2,
          ownerUserId: actorId,
          projectId: input.projectId,
          conversations: [
            {
              id: input.conversationId,
              ownerUserId: actorId,
              projectId: input.projectId,
              visibility: 'private',
              title: 'Agent conversation fixture',
              messages: [],
              tasks: [task],
              createdAt,
              updatedAt: createdAt,
            },
          ],
          projectContexts: [],
        }),
      ],
    )
    return
  }
  const payload = current.rows[0].payload as {
    conversations: Array<{ id: string; tasks: Array<{ id: string }> }>
  } & Record<string, unknown>
  const conversation = payload.conversations.find(candidate => candidate.id === input.conversationId)
  if (conversation) {
    const existingTask = conversation.tasks.find(candidate => candidate.id === input.taskId)
    if (existingTask) Object.assign(existingTask, task)
    else conversation.tasks.push(task)
  } else {
    payload.conversations.push({
      id: input.conversationId,
      ownerUserId: actorId,
      projectId: input.projectId,
      visibility: 'private',
      title: 'Agent conversation fixture',
      messages: [],
      tasks: [task],
      createdAt,
      updatedAt: createdAt,
    } as never)
  }
  await admin.query(
    'update app.agent_workspaces set payload=$3::jsonb, revision=revision+1 where owner_id=$1 and project_id=$2',
    [actorId, input.projectId, JSON.stringify(payload)],
  )
}

export async function createAgentTaskRunFixture(
  admin: Pool,
  repository: Repository,
  actorId: string,
  input: CreateTaskRunInput,
) {
  if (!repository.createAgentTaskRun) throw new Error('Agent task repository is unavailable')
  await ensureAgentTaskWorkspace(admin, actorId, input)
  return repository.createAgentTaskRun(actorId, input)
}
