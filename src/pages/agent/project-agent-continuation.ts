import { continuePersistedAgentTaskRun, syncAgentWorkspaceProject } from '@/features/agent'
import type { AgentAttachmentInput, AgentConversation } from '@/features/agent'

export type ContinueSemanticTaskRunRequest = {
  ownerUserId: string
  projectId: string
  conversationId: string
  taskRunId: string
  questionId: string
  response: string
  turnId: string
  attachmentIds?: string[]
}

function stableHash32(value: string, seed: number): string {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function semanticContinuationIdempotencyKey(
  input: Pick<ContinueSemanticTaskRunRequest, 'taskRunId' | 'questionId' | 'turnId' | 'attachmentIds'>,
): string {
  const value = [input.taskRunId, input.questionId, input.turnId, [...(input.attachmentIds ?? [])].sort().join(',')]
    .map(part => `${part.length}:${part}`)
    .join('|')
  const digest = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map(seed => stableHash32(value, seed)).join('')
  return `continue:v1:${digest}`
}

export function semanticTaskStartIdempotencyKey(taskId: string): string {
  const value = `${taskId.length}:${taskId}`
  const digest = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map(seed => stableHash32(value, seed)).join('')
  return `task-run:v1:${digest}`
}

export async function syncAgentTaskWorkspaceBarrier(
  input: { ownerUserId: string; projectId: string; conversationId: string; taskId: string },
  syncWorkspace: typeof syncAgentWorkspaceProject = syncAgentWorkspaceProject,
): Promise<void> {
  const result = await syncWorkspace({ ownerUserId: input.ownerUserId, projectId: input.projectId })
  if (result.status === 'local-offline') throw new Error('工作区尚未同步，任务未启动')
  if (result.project.version !== 2) throw new Error('历史工作区尚未升级，任务未启动')
  const conversation = result.project.conversations.find(candidate => candidate.id === input.conversationId)
  if (!conversation?.tasks.some(task => task.id === input.taskId)) {
    throw new Error('任务尚未写入远端工作区，任务未启动')
  }
}

export async function continueSemanticTaskRunForConversation(
  input: ContinueSemanticTaskRunRequest,
  continueRun: typeof continuePersistedAgentTaskRun = continuePersistedAgentTaskRun,
): Promise<void> {
  await continueRun({
    ownerUserId: input.ownerUserId,
    projectId: input.projectId,
    conversationId: input.conversationId,
    taskRunId: input.taskRunId,
    questionId: input.questionId,
    response: input.response,
    ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
    idempotencyKey: semanticContinuationIdempotencyKey(input),
  })
}

export type RetrySemanticTaskInput = {
  conversation: AgentConversation
  taskId: string
  prompt: string
  attachments: AgentAttachmentInput[]
}

export type RetrySemanticTaskDependencies = {
  reloadWorkspace: () => Promise<boolean>
  readConversation: () => AgentConversation | undefined
  refreshRun: (conversationId: string, taskRunId: string) => Promise<unknown>
  replayTask: (
    conversation: AgentConversation,
    prompt: string,
    attachments: AgentAttachmentInput[],
    taskId: string,
  ) => Promise<void>
}

export async function retrySemanticTaskInPlace(
  input: RetrySemanticTaskInput,
  dependencies: RetrySemanticTaskDependencies,
): Promise<'recovered' | 'replayed'> {
  if (!(await dependencies.reloadWorkspace())) {
    throw new Error('无法确认服务端任务状态，请稍后重试')
  }
  const conversation = dependencies.readConversation() ?? input.conversation
  const task = conversation.tasks.find(candidate => candidate.id === input.taskId)
  if (task?.taskRunId) {
    await dependencies.refreshRun(conversation.id, task.taskRunId)
    return 'recovered'
  }
  await dependencies.replayTask(conversation, input.prompt, input.attachments, input.taskId)
  return 'replayed'
}
