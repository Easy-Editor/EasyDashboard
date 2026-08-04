import { nanoid } from 'nanoid'
import type {
  AgentAttachment,
  AgentAttachmentInput,
  AgentConversation,
  AgentMessage,
  AgentPreferences,
  AgentProjectContext,
  AgentProjectContextRevision,
  AgentProjectContextTombstone,
  AgentStorage,
  AgentStore,
  AgentTask,
  AgentTaskStage,
  AgentWorkspace,
  AgentWorkspaceListener,
  AppendAgentTurnInput,
  CreateAgentConversationInput,
  RecordAgentPlanResultInput,
  RecordAgentRunInput,
  RecordAgentRunRollbackInput,
  RecordAgentTaskPlanInput,
  RecordAgentTaskQuestionInput,
  RecordAgentTaskRunDetailInput,
  SetAgentMessageAttachmentsInput,
  UpdateTaskProgressInput,
  UpsertProjectContextInput,
} from './types'

const STORAGE_PREFIX = 'easy-dashboard:agent-workspace:v1:'
const RECOVERY_PREFIX = 'easy-dashboard:agent-workspace:recovery:v1:'
const workspaceListeners = new Map<string, Set<AgentWorkspaceListener>>()

export const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
  defaultAttachmentScope: 'conversation',
  rememberProjectContext: true,
  showTaskProgress: true,
}

function storageKey(ownerUserId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(ownerUserId)}`
}

function recoveryKey(ownerUserId: string): string {
  return `${RECOVERY_PREFIX}${encodeURIComponent(ownerUserId)}`
}

function defaultStorage(): AgentStorage {
  if (typeof window === 'undefined') {
    throw new Error('Agent storage is unavailable outside the browser; inject a Storage implementation')
  }
  return window.localStorage
}

function resolveStorage(storage?: AgentStorage): AgentStorage {
  return storage ?? defaultStorage()
}

function timestamp(value?: string): string {
  return value ?? new Date().toISOString()
}

export function createEmptyAgentWorkspace(ownerUserId: string): AgentWorkspace {
  return {
    version: 2,
    ownerUserId,
    preferences: { ...DEFAULT_AGENT_PREFERENCES },
    conversations: [],
    projectContexts: [],
    projectContextTombstones: [],
  }
}

export function getProjectConversationsFromWorkspace(
  workspace: AgentWorkspace,
  projectId: string,
): AgentConversation[] {
  return workspace.conversations
    .filter(conversation => conversation.projectId === projectId)
    .map(conversation => structuredClone(conversation))
}

export function getConversationFromWorkspace(
  workspace: AgentWorkspace,
  conversationId: string,
): AgentConversation | undefined {
  const conversation = workspace.conversations.find(candidate => candidate.id === conversationId)
  return conversation ? structuredClone(conversation) : undefined
}

function cloneWorkspace(workspace: AgentWorkspace): AgentWorkspace {
  return structuredClone(workspace)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function isAttachment(value: unknown): value is AgentAttachment {
  const candidate = record(value)
  return Boolean(
    candidate &&
      typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      (candidate.scope === 'conversation' || candidate.scope === 'project') &&
      (candidate.mimeType === undefined || typeof candidate.mimeType === 'string') &&
      (candidate.type === undefined || typeof candidate.type === 'string') &&
      (candidate.size === undefined ||
        (typeof candidate.size === 'number' && Number.isFinite(candidate.size) && candidate.size >= 0)) &&
      (candidate.url === undefined || typeof candidate.url === 'string') &&
      typeof candidate.projectId === 'string' &&
      typeof candidate.conversationId === 'string' &&
      typeof candidate.createdAt === 'string',
  )
}

function isMessage(value: unknown): value is AgentMessage {
  const candidate = record(value)
  return Boolean(
    candidate &&
      typeof candidate.id === 'string' &&
      (candidate.role === 'user' || candidate.role === 'assistant' || candidate.role === 'system') &&
      typeof candidate.content === 'string' &&
      Array.isArray(candidate.attachments) &&
      candidate.attachments.every(isAttachment) &&
      typeof candidate.createdAt === 'string' &&
      (candidate.taskId === undefined || typeof candidate.taskId === 'string'),
  )
}

function isTaskStage(value: unknown): value is AgentTaskStage {
  const candidate = record(value)
  return Boolean(
    candidate &&
      (candidate.id === 'understand-requirements' ||
        candidate.id === 'plan-layout' ||
        candidate.id === 'bind-data' ||
        candidate.id === 'preview-check') &&
      typeof candidate.title === 'string' &&
      (candidate.status === 'pending' ||
        candidate.status === 'waiting' ||
        candidate.status === 'running' ||
        candidate.status === 'complete' ||
        candidate.status === 'failed') &&
      (candidate.detail === undefined || typeof candidate.detail === 'string'),
  )
}

function isTaskPlan(value: unknown): value is NonNullable<AgentTask['plan']> {
  const candidate = record(value)
  return Boolean(
    candidate &&
      typeof candidate.summary === 'string' &&
      Array.isArray(candidate.steps) &&
      candidate.steps.every(value => {
        const step = record(value)
        return Boolean(
          step &&
            typeof step.id === 'string' &&
            typeof step.title === 'string' &&
            (step.status === 'pending' ||
              step.status === 'running' ||
              step.status === 'complete' ||
              step.status === 'failed' ||
              step.status === 'canceled') &&
            (step.detail === undefined || typeof step.detail === 'string'),
        )
      }),
  )
}

function isPendingQuestion(value: unknown): value is NonNullable<AgentTask['pendingQuestion']> {
  const candidate = record(value)
  return Boolean(
    candidate &&
      typeof candidate.id === 'string' &&
      typeof candidate.messageId === 'string' &&
      typeof candidate.prompt === 'string' &&
      typeof candidate.askedAt === 'string',
  )
}

function isTask(value: unknown, workspaceVersion: 1 | 2): value is AgentTask {
  const candidate = record(value)
  const usage = candidate ? record(candidate.usage) : null
  const stages = candidate && Array.isArray(candidate.stages) ? candidate.stages : []
  const stageIds = new Set(stages.flatMap(stage => (isTaskStage(stage) ? [stage.id] : [])))
  return Boolean(
    candidate &&
      typeof candidate.id === 'string' &&
      typeof candidate.title === 'string' &&
      (candidate.status === 'waiting' ||
        candidate.status === 'waiting_user' ||
        candidate.status === 'paused' ||
        candidate.status === 'running' ||
        candidate.status === 'complete' ||
        candidate.status === 'failed' ||
        candidate.status === 'canceled') &&
      stages.every(isTaskStage) &&
      stageIds.size === stages.length &&
      (workspaceVersion === 2 || stages.length === 4) &&
      (candidate.taskRunId === undefined || typeof candidate.taskRunId === 'string') &&
      (candidate.plan === undefined || isTaskPlan(candidate.plan)) &&
      (candidate.pendingQuestion === undefined || isPendingQuestion(candidate.pendingQuestion)) &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.updatedAt === 'string' &&
      (candidate.usage === undefined ||
        (usage &&
          [usage.promptTokens, usage.completionTokens, usage.totalTokens].every(
            tokenCount => tokenCount === undefined || (typeof tokenCount === 'number' && tokenCount >= 0),
          ))) &&
      (candidate.run === undefined || typeof candidate.run === 'object'),
  )
}

function isConversation(value: unknown, ownerUserId: string, workspaceVersion: 1 | 2): value is AgentConversation {
  const candidate = record(value)
  return Boolean(
    candidate &&
      typeof candidate.id === 'string' &&
      candidate.ownerUserId === ownerUserId &&
      typeof candidate.projectId === 'string' &&
      (candidate.projectName === undefined || typeof candidate.projectName === 'string') &&
      candidate.visibility === 'private' &&
      typeof candidate.title === 'string' &&
      Array.isArray(candidate.messages) &&
      candidate.messages.every(isMessage) &&
      Array.isArray(candidate.tasks) &&
      candidate.tasks.every(task => isTask(task, workspaceVersion)) &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.updatedAt === 'string',
  )
}

function isContextRevision(value: unknown): value is AgentProjectContextRevision {
  const candidate = record(value)
  return Boolean(
    candidate &&
      typeof candidate.revision === 'number' &&
      Number.isInteger(candidate.revision) &&
      candidate.revision > 0 &&
      typeof candidate.title === 'string' &&
      typeof candidate.content === 'string' &&
      (candidate.status === 'pending' || candidate.status === 'confirmed') &&
      (candidate.sourceTaskId === undefined || typeof candidate.sourceTaskId === 'string') &&
      (candidate.provenance === undefined || isProjectContextProvenance(candidate.provenance)) &&
      typeof candidate.createdAt === 'string',
  )
}

function isProjectContextProvenance(value: unknown): boolean {
  const candidate = record(value)
  return Boolean(
    candidate &&
      (candidate.origin === 'agent_task' || candidate.origin === 'manual') &&
      Array.isArray(candidate.sourceKinds) &&
      candidate.sourceKinds.length >= 1 &&
      candidate.sourceKinds.length <= 3 &&
      candidate.sourceKinds.every(
        sourceKind => sourceKind === 'user_request' || sourceKind === 'agent_plan' || sourceKind === 'agent_result',
      ),
  )
}

function isProjectContext(value: unknown): value is AgentProjectContext {
  const candidate = record(value)
  return Boolean(
    candidate &&
      typeof candidate.id === 'string' &&
      typeof candidate.projectId === 'string' &&
      typeof candidate.title === 'string' &&
      typeof candidate.content === 'string' &&
      (candidate.status === 'pending' || candidate.status === 'confirmed') &&
      (candidate.revision === undefined ||
        (typeof candidate.revision === 'number' && Number.isInteger(candidate.revision) && candidate.revision > 0)) &&
      (candidate.history === undefined ||
        (Array.isArray(candidate.history) && candidate.history.every(isContextRevision))) &&
      (candidate.sourceTaskId === undefined || typeof candidate.sourceTaskId === 'string') &&
      (candidate.provenance === undefined || isProjectContextProvenance(candidate.provenance)) &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.updatedAt === 'string' &&
      (candidate.confirmedAt === undefined || typeof candidate.confirmedAt === 'string'),
  )
}

function isProjectContextTombstone(value: unknown): value is AgentProjectContextTombstone {
  const candidate = record(value)
  return Boolean(
    candidate &&
      typeof candidate.id === 'string' &&
      typeof candidate.projectId === 'string' &&
      typeof candidate.deletedAt === 'string',
  )
}

function isAgentWorkspace(value: unknown, ownerUserId: string): value is AgentWorkspace {
  const candidate = record(value)
  const preferences = candidate ? record(candidate.preferences) : null
  const version = candidate?.version
  return Boolean(
    candidate &&
      (version === 1 || version === 2) &&
      candidate.ownerUserId === ownerUserId &&
      preferences &&
      (preferences.defaultAttachmentScope === undefined ||
        preferences.defaultAttachmentScope === 'conversation' ||
        preferences.defaultAttachmentScope === 'project') &&
      (preferences.rememberProjectContext === undefined || typeof preferences.rememberProjectContext === 'boolean') &&
      (preferences.showTaskProgress === undefined || typeof preferences.showTaskProgress === 'boolean') &&
      Array.isArray(candidate.conversations) &&
      candidate.conversations.every(conversation => isConversation(conversation, ownerUserId, version)) &&
      Array.isArray(candidate.projectContexts) &&
      candidate.projectContexts.every(isProjectContext) &&
      (candidate.projectContextTombstones === undefined ||
        (Array.isArray(candidate.projectContextTombstones) &&
          candidate.projectContextTombstones.every(isProjectContextTombstone))),
  )
}

function normalizeAgentWorkspace(workspace: AgentWorkspace): AgentWorkspace {
  return {
    ...workspace,
    version: 2,
    preferences: { ...DEFAULT_AGENT_PREFERENCES, ...workspace.preferences },
    projectContexts: workspace.projectContexts.map(context => ({
      ...context,
      revision: context.revision ?? 1,
      history: Array.isArray(context.history) ? context.history : [],
    })),
    projectContextTombstones: workspace.projectContextTombstones ?? [],
  }
}

export function decodeAgentWorkspace(value: unknown, ownerUserId: string): AgentWorkspace {
  if (!isAgentWorkspace(value, ownerUserId)) throw new Error('Invalid Agent workspace payload')
  return cloneWorkspace(normalizeAgentWorkspace(value))
}

export function replaceAgentWorkspace(workspace: AgentWorkspace, storage?: AgentStorage): AgentWorkspace {
  const snapshot = cloneWorkspace(workspace)
  resolveStorage(storage).setItem(storageKey(workspace.ownerUserId), JSON.stringify(snapshot))
  for (const listener of workspaceListeners.get(workspace.ownerUserId) ?? []) {
    listener(cloneWorkspace(snapshot))
  }
  return snapshot
}

export function subscribeAgentWorkspace(ownerUserId: string, listener: AgentWorkspaceListener): () => void {
  const listeners = workspaceListeners.get(ownerUserId) ?? new Set<AgentWorkspaceListener>()
  listeners.add(listener)
  workspaceListeners.set(ownerUserId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) workspaceListeners.delete(ownerUserId)
  }
}

export function readAgentWorkspace(ownerUserId: string, storage?: AgentStorage): AgentWorkspace {
  const targetStorage = resolveStorage(storage)
  const serialized = targetStorage.getItem(storageKey(ownerUserId))
  if (!serialized) return createEmptyAgentWorkspace(ownerUserId)

  try {
    const parsed: unknown = JSON.parse(serialized)
    return decodeAgentWorkspace(parsed, ownerUserId)
  } catch {
    // The unreadable payload is quarantined below before the caller can write
    // a new workspace over the only recoverable copy.
  }

  if (!targetStorage.getItem(recoveryKey(ownerUserId))) {
    targetStorage.setItem(recoveryKey(ownerUserId), serialized)
  }
  return createEmptyAgentWorkspace(ownerUserId)
}

export function hasAgentWorkspaceRecovery(ownerUserId: string, storage?: AgentStorage): boolean {
  return Boolean(resolveStorage(storage).getItem(recoveryKey(ownerUserId)))
}

function createAttachments(
  inputs: AgentAttachmentInput[],
  projectId: string,
  conversationId: string,
  createdAt: string,
): AgentAttachment[] {
  return inputs.map(input => ({
    ...input,
    id: input.id ?? nanoid(),
    projectId,
    conversationId,
    createdAt,
  }))
}

function createMessage(
  role: AgentMessage['role'],
  content: string,
  attachments: AgentAttachment[],
  createdAt: string,
  taskId?: string,
  localOnlyExecutionProjection = false,
): AgentMessage {
  return {
    id: nanoid(),
    ...(taskId ? { taskId } : {}),
    ...(localOnlyExecutionProjection ? { localOnlyExecutionProjection: true as const } : {}),
    role,
    content,
    attachments,
    createdAt,
  }
}

export function createInitialAgentTask(createdAt: string): AgentTask {
  return {
    id: nanoid(),
    title: 'Agent 修改任务',
    status: 'waiting',
    stages: [],
    createdAt,
    updatedAt: createdAt,
  }
}

export function createAgentConversation(
  input: CreateAgentConversationInput,
  storage?: AgentStorage,
): AgentConversation {
  const workspace = readAgentWorkspace(input.ownerUserId, storage)
  const createdAt = timestamp(input.createdAt)
  const conversationId = nanoid()
  const content = (input.initialMessage ?? input.prompt)?.trim() ?? ''
  const attachments = createAttachments(input.attachments ?? [], input.projectId, conversationId, createdAt)
  const initialTask = content || attachments.length > 0 ? createInitialAgentTask(createdAt) : undefined
  const messages = initialTask ? [createMessage('user', content, attachments, createdAt, initialTask.id)] : []
  const conversation: AgentConversation = {
    id: conversationId,
    ownerUserId: input.ownerUserId,
    projectId: input.projectId,
    projectName: input.projectName?.trim() ?? '',
    visibility: 'private',
    title: input.title?.trim() || content.slice(0, 40) || '新对话',
    messages,
    tasks: initialTask ? [initialTask] : [],
    createdAt,
    updatedAt: createdAt,
  }

  workspace.conversations.push(conversation)
  replaceAgentWorkspace(workspace, storage)
  return structuredClone(conversation)
}

export function appendAgentTurn(input: AppendAgentTurnInput, storage?: AgentStorage): AgentConversation {
  const workspace = readAgentWorkspace(input.ownerUserId, storage)
  const conversation = workspace.conversations.find(candidate => candidate.id === input.conversationId)
  if (!conversation) throw new Error(`Unknown agent conversation: ${input.conversationId}`)

  const createdAt = timestamp(input.createdAt)
  const attachments = createAttachments(input.attachments ?? [], conversation.projectId, conversation.id, createdAt)
  const role = input.role ?? 'user'
  const latestTask = conversation.tasks.at(-1)
  const implicitClarificationTask =
    role === 'user' &&
    !input.taskId &&
    latestTask?.status === 'waiting_user' &&
    latestTask.pendingQuestion !== undefined
      ? latestTask
      : undefined
  const continuedTask = input.taskId
    ? conversation.tasks.find(candidate => candidate.id === input.taskId)
    : implicitClarificationTask
  if (input.taskId && !continuedTask) throw new Error(`Unknown agent task: ${input.taskId}`)
  const createdTask = role === 'user' && !continuedTask ? createInitialAgentTask(createdAt) : undefined
  conversation.messages.push(
    createMessage(role, input.content, attachments, createdAt, continuedTask?.id ?? createdTask?.id),
  )
  if (createdTask) conversation.tasks.push(createdTask)
  if (role === 'user' && continuedTask) {
    continuedTask.status = 'waiting'
    continuedTask.pendingQuestion = undefined
    continuedTask.updatedAt = createdAt
  }
  conversation.updatedAt = createdAt
  replaceAgentWorkspace(workspace, storage)
  return structuredClone(conversation)
}

export function setAgentMessageAttachments(
  input: SetAgentMessageAttachmentsInput,
  storage?: AgentStorage,
): AgentConversation {
  const workspace = readAgentWorkspace(input.ownerUserId, storage)
  const conversation = workspace.conversations.find(candidate => candidate.id === input.conversationId)
  if (!conversation) throw new Error(`Unknown agent conversation: ${input.conversationId}`)
  const message = conversation.messages.find(candidate => candidate.id === input.messageId)
  if (!message) throw new Error(`Unknown agent message: ${input.messageId}`)

  const updatedAt = timestamp(input.updatedAt)
  message.attachments = createAttachments(input.attachments, conversation.projectId, conversation.id, updatedAt)
  conversation.updatedAt = updatedAt
  replaceAgentWorkspace(workspace, storage)
  return structuredClone(conversation)
}

export function getProjectConversations(
  ownerUserId: string,
  projectId: string,
  storage?: AgentStorage,
): AgentConversation[] {
  return getProjectConversationsFromWorkspace(readAgentWorkspace(ownerUserId, storage), projectId)
}

export function getProjectAttachmentManifest(
  ownerUserId: string,
  projectId: string,
  storage?: AgentStorage,
): AgentAttachment[] {
  const workspace = readAgentWorkspace(ownerUserId, storage)
  return workspace.conversations
    .filter(conversation => conversation.projectId === projectId)
    .flatMap(conversation => conversation.messages)
    .flatMap(message => message.attachments)
    .filter(attachment => attachment.scope === 'project')
    .map(attachment => structuredClone(attachment))
    .sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))
}

export function getProjectContexts(
  ownerUserId: string,
  projectId: string,
  storage?: AgentStorage,
): AgentProjectContext[] {
  return readAgentWorkspace(ownerUserId, storage)
    .projectContexts.filter(context => context.projectId === projectId)
    .map(context => structuredClone(context))
    .sort((first, second) => {
      if (first.status !== second.status) return first.status === 'pending' ? -1 : 1
      return Date.parse(first.updatedAt) - Date.parse(second.updatedAt)
    })
}

export function getConversation(
  ownerUserId: string,
  conversationId: string,
  storage?: AgentStorage,
): AgentConversation | undefined {
  return getConversationFromWorkspace(readAgentWorkspace(ownerUserId, storage), conversationId)
}

export function getTaskUserMessage(conversation: AgentConversation, taskId: string): AgentMessage | undefined {
  const message = conversation.messages.find(candidate => candidate.role === 'user' && candidate.taskId === taskId)
  return message ? structuredClone(message) : undefined
}

export function updateTaskProgress(input: UpdateTaskProgressInput, storage?: AgentStorage): AgentTask {
  const workspace = readAgentWorkspace(input.ownerUserId, storage)
  const conversation = workspace.conversations.find(candidate => candidate.id === input.conversationId)
  if (!conversation) throw new Error(`Unknown agent conversation: ${input.conversationId}`)

  const task = input.taskId
    ? conversation.tasks.find(candidate => candidate.id === input.taskId)
    : conversation.tasks[0]
  if (!task) throw new Error(`Unknown agent task: ${input.taskId ?? 'default'}`)

  if (input.taskStatus) task.status = input.taskStatus
  if (input.usage) task.usage = { ...input.usage }
  if (input.stageId) {
    const stage = task.stages.find(candidate => candidate.id === input.stageId)
    if (stage) {
      if (input.stageStatus) stage.status = input.stageStatus
      if (input.detail === undefined) {
        if (input.stageStatus && input.stageStatus !== 'waiting') stage.detail = undefined
      } else if (input.detail) {
        stage.detail = input.detail
      } else {
        stage.detail = undefined
      }
    } else if (task.stages.length > 0) {
      throw new Error(`Unknown agent task stage: ${input.stageId}`)
    }
  }

  const updatedAt = timestamp(input.updatedAt)
  task.updatedAt = updatedAt
  conversation.updatedAt = updatedAt
  replaceAgentWorkspace(workspace, storage)
  return structuredClone(task)
}

export function recordAgentPlanResult(input: RecordAgentPlanResultInput, storage?: AgentStorage): AgentConversation {
  const workspace = readAgentWorkspace(input.ownerUserId, storage)
  const conversation = workspace.conversations.find(candidate => candidate.id === input.conversationId)
  if (!conversation) throw new Error(`Unknown agent conversation: ${input.conversationId}`)
  const task = conversation.tasks.find(candidate => candidate.id === input.taskId)
  if (!task) throw new Error(`Unknown agent task: ${input.taskId}`)

  const updatedAt = timestamp(input.updatedAt)
  const assistantMessage = input.message.trim()
  if (
    assistantMessage &&
    !conversation.messages.some(
      message => message.role === 'assistant' && message.taskId === task.id && message.content === assistantMessage,
    )
  ) {
    conversation.messages.push(createMessage('assistant', assistantMessage, [], updatedAt, task.id))
  }

  const planningStage = task.stages.find(stage => stage.id === 'plan-layout')
  const dataStage = task.stages.find(stage => stage.id === 'bind-data')
  if (planningStage && dataStage) {
    planningStage.status = 'complete'
    planningStage.detail = undefined
    dataStage.status = 'waiting'
    dataStage.detail = '方案已确定，正在执行修改'
  }
  task.status = 'waiting'
  if (input.usage) task.usage = { ...input.usage }
  task.updatedAt = updatedAt
  conversation.updatedAt = updatedAt

  replaceAgentWorkspace(workspace, storage)
  return structuredClone(conversation)
}

export function recordAgentTaskQuestion(
  input: RecordAgentTaskQuestionInput,
  storage?: AgentStorage,
): AgentConversation {
  const workspace = readAgentWorkspace(input.ownerUserId, storage)
  const conversation = workspace.conversations.find(candidate => candidate.id === input.conversationId)
  const task = conversation?.tasks.find(candidate => candidate.id === input.taskId)
  if (!conversation || !task) throw new Error(`Unknown Agent task: ${input.taskId}`)

  const updatedAt = timestamp(input.updatedAt)
  let questionMessage = task.pendingQuestion
    ? conversation.messages.find(message => message.id === task.pendingQuestion?.messageId)
    : undefined
  if (!questionMessage || task.pendingQuestion?.id !== input.questionId) {
    questionMessage = createMessage(
      'assistant',
      input.message.trim(),
      [],
      updatedAt,
      task.id,
      input.localOnlyExecutionProjection,
    )
    conversation.messages.push(questionMessage)
  }

  task.status = 'waiting_user'
  task.plan = input.plan ? structuredClone(input.plan) : task.plan
  task.pendingQuestion = {
    id: input.questionId,
    messageId: questionMessage.id,
    prompt: (input.prompt ?? input.message).trim(),
    askedAt: updatedAt,
  }
  if (input.usage) task.usage = { ...input.usage }
  const planningStage = task.stages.find(stage => stage.id === 'plan-layout')
  if (planningStage) {
    planningStage.status = 'waiting'
    planningStage.detail = '等待你的回答'
  }
  task.updatedAt = updatedAt
  if (!input.localOnlyExecutionProjection) conversation.updatedAt = updatedAt
  replaceAgentWorkspace(workspace, storage)
  return structuredClone(conversation)
}

export function recordAgentTaskPlan(input: RecordAgentTaskPlanInput, storage?: AgentStorage): AgentTask {
  const workspace = readAgentWorkspace(input.ownerUserId, storage)
  const conversation = workspace.conversations.find(candidate => candidate.id === input.conversationId)
  const task = conversation?.tasks.find(candidate => candidate.id === input.taskId)
  if (!conversation || !task) throw new Error(`Unknown Agent task: ${input.taskId}`)

  const updatedAt = timestamp(input.updatedAt)
  task.plan = structuredClone(input.plan)
  task.status = input.taskStatus ?? 'running'
  task.pendingQuestion = undefined
  if (input.usage) task.usage = { ...input.usage }
  const planningStage = task.stages.find(stage => stage.id === 'plan-layout')
  if (planningStage && task.status === 'running') {
    planningStage.status = 'running'
    planningStage.detail = undefined
  }
  task.updatedAt = updatedAt
  conversation.updatedAt = updatedAt
  replaceAgentWorkspace(workspace, storage)
  return structuredClone(task)
}

export function recordAgentRun(input: RecordAgentRunInput, storage?: AgentStorage): AgentTask {
  const workspace = readAgentWorkspace(input.ownerUserId, storage)
  const conversation = workspace.conversations.find(candidate => candidate.id === input.conversationId)
  const task = conversation?.tasks.find(candidate => candidate.id === input.taskId)
  if (!conversation || !task) throw new Error(`Unknown Agent task: ${input.taskId}`)
  const plan = task.stages.find(stage => stage.id === 'plan-layout')
  const data = task.stages.find(stage => stage.id === 'bind-data')
  const preview = task.stages.find(stage => stage.id === 'preview-check')
  const updatedAt = timestamp(input.updatedAt)
  const assistantMessage = input.message?.trim()
  if (
    assistantMessage &&
    !conversation.messages.some(
      message => message.role === 'assistant' && message.taskId === task.id && message.content === assistantMessage,
    )
  ) {
    conversation.messages.push(
      createMessage('assistant', assistantMessage, [], updatedAt, task.id, input.localOnlyExecutionProjection),
    )
  }
  const trace = input.trace ?? task.run?.trace
  task.run = {
    operationId: input.operationId,
    status: input.status,
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(input.receipt === undefined ? {} : { receipt: input.receipt }),
    ...(input.cost === undefined ? {} : { cost: input.cost }),
    ...(trace === undefined ? {} : { trace: structuredClone(trace) }),
    ...(input.rollback === undefined ? {} : { rollback: input.rollback }),
    ...((input.rolledBackAt ?? task.run?.rolledBackAt)
      ? { rolledBackAt: input.rolledBackAt ?? task.run?.rolledBackAt }
      : {}),
    ...((input.rollbackReceipt ?? task.run?.rollbackReceipt)
      ? { rollbackReceipt: input.rollbackReceipt ?? task.run?.rollbackReceipt }
      : {}),
  }
  if (input.usage) task.usage = { ...input.usage }
  if (input.status === 'planning') {
    task.status = 'running'
    if (plan) {
      plan.status = 'running'
      Reflect.deleteProperty(plan, 'detail')
    }
  } else if (input.status === 'running') {
    task.status = 'running'
    if (plan && data) {
      plan.status = 'complete'
      Reflect.deleteProperty(plan, 'detail')
      data.status = 'running'
      Reflect.deleteProperty(data, 'detail')
    }
  } else if (input.status === 'prepared') {
    task.status = 'running'
    if (plan && data && preview) {
      plan.status = 'complete'
      Reflect.deleteProperty(plan, 'detail')
      data.status = 'complete'
      Reflect.deleteProperty(data, 'detail')
      preview.status = 'waiting'
      preview.detail = '候选变更已准备，等待持久提交'
    }
  } else if (input.status === 'committed') {
    task.status = 'complete'
    if (plan && data && preview) {
      plan.status = 'complete'
      Reflect.deleteProperty(plan, 'detail')
      data.status = 'complete'
      Reflect.deleteProperty(data, 'detail')
      preview.status = 'complete'
      Reflect.deleteProperty(preview, 'detail')
    }
  } else if (input.status === 'paused') {
    task.status = 'paused'
  } else if (input.status === 'canceled') {
    task.status = 'canceled'
  } else {
    task.status = 'failed'
    if (plan) Reflect.deleteProperty(plan, 'detail')
    if (preview) {
      preview.status = 'failed'
      preview.detail =
        input.status === 'stale'
          ? '项目版本已变化，请基于最新草稿重试'
          : input.status === 'indeterminate'
            ? '执行结果无法自动确认，请人工检查项目与账单后再决定是否重试'
            : '真实执行未完成'
    }
  }
  task.updatedAt = updatedAt
  if (!input.localOnlyExecutionProjection) conversation.updatedAt = updatedAt
  replaceAgentWorkspace(workspace, storage)
  return structuredClone(task)
}

function semanticTaskStatus(status: RecordAgentTaskRunDetailInput['detail']['status']): AgentTask['status'] {
  if (status === 'waiting_user') return 'waiting_user'
  if (status === 'paused' || status === 'blocked_material') return 'paused'
  if (status === 'completed') return 'complete'
  if (status === 'failed' || status === 'rollback_blocked') return 'failed'
  if (status === 'canceled' || status === 'rolled_back') return 'canceled'
  return 'running'
}

const terminalSemanticRunStatuses = new Set<RecordAgentTaskRunDetailInput['detail']['status']>([
  'completed',
  'failed',
  'canceled',
  'rolled_back',
  'rollback_blocked',
])

const semanticRunStatusRank: Record<RecordAgentTaskRunDetailInput['detail']['status'], number> = {
  planning: 0,
  waiting_user: 1,
  blocked_material: 1,
  paused: 1,
  running: 2,
  verifying: 3,
  rolling_back: 4,
  completed: 5,
  failed: 5,
  canceled: 5,
  rolled_back: 5,
  rollback_blocked: 5,
}

function preferIncomingTaskRun(
  current: NonNullable<AgentTask['taskRun']>,
  incoming: NonNullable<AgentTask['taskRun']>,
): boolean {
  if (terminalSemanticRunStatuses.has(current.status)) return false
  if (terminalSemanticRunStatuses.has(incoming.status)) return true
  if (incoming.latestEventSequence !== current.latestEventSequence) {
    return incoming.latestEventSequence > current.latestEventSequence
  }
  if (incoming.activePlanVersion !== current.activePlanVersion) {
    return incoming.activePlanVersion > current.activePlanVersion
  }
  const incomingTime = Date.parse(incoming.updatedAt)
  const currentTime = Date.parse(current.updatedAt)
  if (incomingTime !== currentTime) return incomingTime > currentTime
  return semanticRunStatusRank[incoming.status] > semanticRunStatusRank[current.status]
}

function mergeTaskRunAccounting(
  current: NonNullable<AgentTask['taskRun']>['accounting'],
  incoming: NonNullable<AgentTask['taskRun']>['accounting'],
): NonNullable<AgentTask['taskRun']>['accounting'] {
  return {
    providerTurns: Math.max(current.providerTurns, incoming.providerTurns),
    executorRetries: Math.max(current.executorRetries, incoming.executorRetries),
    semanticRevisions: Math.max(current.semanticRevisions, incoming.semanticRevisions),
    promptTokens: Math.max(current.promptTokens, incoming.promptTokens),
    completionTokens: Math.max(current.completionTokens, incoming.completionTokens),
    costMicros: Math.max(current.costMicros, incoming.costMicros),
  }
}

function mergeSemanticTaskRun(
  current: AgentTask['taskRun'],
  incoming: NonNullable<AgentTask['taskRun']>,
): { taskRun: NonNullable<AgentTask['taskRun']>; preferIncoming: boolean } {
  if (!current) return { taskRun: structuredClone(incoming), preferIncoming: true }
  const preferIncoming = preferIncomingTaskRun(current, incoming)
  const preferred = preferIncoming ? incoming : current
  return {
    preferIncoming,
    taskRun: {
      ...structuredClone(preferred),
      activePlanVersion: Math.max(current.activePlanVersion, incoming.activePlanVersion),
      latestEventSequence: Math.max(current.latestEventSequence, incoming.latestEventSequence),
      accounting: mergeTaskRunAccounting(current.accounting, incoming.accounting),
      createdAt:
        Date.parse(current.createdAt) <= Date.parse(incoming.createdAt) ? current.createdAt : incoming.createdAt,
      updatedAt:
        Date.parse(current.updatedAt) >= Date.parse(incoming.updatedAt) ? current.updatedAt : incoming.updatedAt,
      completedAt: current.completedAt ?? incoming.completedAt,
    },
  }
}

const terminalSemanticStepStatuses = new Set(['passed', 'failed', 'superseded'])
const semanticStepStatusRank = {
  pending: 0,
  running: 1,
  revising: 2,
  verifying: 3,
  passed: 4,
  failed: 4,
  superseded: 4,
}

function mergeActivePlan(
  current: AgentTask['activePlan'],
  incoming: RecordAgentTaskRunDetailInput['detail']['activePlan'],
): AgentTask['activePlan'] {
  if (!incoming) return current ? structuredClone(current) : undefined
  if (!current || incoming.version > current.version) return structuredClone(incoming)
  if (incoming.version < current.version) return structuredClone(current)
  const incomingSteps = new Map(incoming.steps.map(step => [step.id, step]))
  const mergedSteps = current.steps.map(step => {
    const candidate = incomingSteps.get(step.id)
    if (!candidate) return structuredClone(step)
    incomingSteps.delete(step.id)
    if (terminalSemanticStepStatuses.has(step.status)) return structuredClone(step)
    if (terminalSemanticStepStatuses.has(candidate.status)) return structuredClone(candidate)
    if (semanticStepStatusRank[candidate.status] > semanticStepStatusRank[step.status])
      return structuredClone(candidate)
    if (semanticStepStatusRank[candidate.status] < semanticStepStatusRank[step.status]) return structuredClone(step)
    return Date.parse(candidate.updatedAt) >= Date.parse(step.updatedAt)
      ? structuredClone(candidate)
      : structuredClone(step)
  })
  return {
    ...structuredClone(current),
    ...structuredClone(incoming),
    steps: [...mergedSteps, ...incomingSteps.values()],
  }
}

export function recordAgentTaskRunDetail(input: RecordAgentTaskRunDetailInput, storage?: AgentStorage): AgentTask {
  const workspace = readAgentWorkspace(input.ownerUserId, storage)
  const conversation = workspace.conversations.find(candidate => candidate.id === input.conversationId)
  const task = conversation?.tasks.find(candidate => candidate.id === input.detail.taskId)
  if (!conversation || !task) throw new Error(`Unknown Agent task: ${input.detail.taskId}`)
  if (task.taskRunId && task.taskRunId !== input.detail.id) {
    throw new Error(`Agent task ${task.id} is already bound to another task run`)
  }

  task.taskRunId = input.detail.id
  const { activePlan, waiting, ...incomingTaskRun } = input.detail
  const mergedRun = mergeSemanticTaskRun(task.taskRun, incomingTaskRun)
  task.taskRun = mergedRun.taskRun
  task.activePlan = mergeActivePlan(task.activePlan, activePlan)
  if (mergedRun.preferIncoming) {
    task.status = semanticTaskStatus(mergedRun.taskRun.status)
    task.pendingQuestion = waiting
      ? {
          id: waiting.questionId,
          messageId: `task-run:${input.detail.id}:question:${waiting.questionId}`,
          prompt: waiting.text,
          askedAt: input.detail.updatedAt,
        }
      : undefined
  }
  task.usage = {
    promptTokens: mergedRun.taskRun.accounting.promptTokens,
    completionTokens: mergedRun.taskRun.accounting.completionTokens,
    totalTokens: mergedRun.taskRun.accounting.promptTokens + mergedRun.taskRun.accounting.completionTokens,
  }
  task.updatedAt = mergedRun.taskRun.updatedAt
  conversation.updatedAt =
    Date.parse(conversation.updatedAt) > Date.parse(task.updatedAt) ? conversation.updatedAt : task.updatedAt

  const activitiesBySequence = new Map((task.activities ?? []).map(event => [event.seq, structuredClone(event)]))
  for (const event of input.events ?? []) {
    if (event.taskRunId !== input.detail.id || event.seq < 1 || activitiesBySequence.has(event.seq)) continue
    activitiesBySequence.set(event.seq, structuredClone(event))
  }
  task.activities = [...activitiesBySequence.values()].sort((first, second) => first.seq - second.seq).slice(-200)
  task.latestEventSequence = Math.max(task.latestEventSequence ?? 0, ...task.activities.map(event => event.seq))

  replaceAgentWorkspace(workspace, storage)
  return structuredClone(task)
}

export function recordAgentRunRollback(input: RecordAgentRunRollbackInput, storage?: AgentStorage): AgentTask {
  const workspace = readAgentWorkspace(input.ownerUserId, storage)
  const conversation = workspace.conversations.find(candidate => candidate.id === input.conversationId)
  const task = conversation?.tasks.find(candidate => candidate.run?.operationId === input.operationId)
  if (!conversation || !task?.run) throw new Error(`Unknown Agent operation: ${input.operationId}`)
  const updatedAt = timestamp(input.updatedAt)
  task.run.rolledBackAt = updatedAt
  if (input.receipt !== undefined) task.run.rollbackReceipt = structuredClone(input.receipt)
  task.updatedAt = updatedAt
  conversation.updatedAt = updatedAt
  replaceAgentWorkspace(workspace, storage)
  return structuredClone(task)
}

export function upsertProjectContext(input: UpsertProjectContextInput, storage?: AgentStorage): AgentProjectContext {
  const workspace = readAgentWorkspace(input.ownerUserId, storage)
  const updatedAt = timestamp(input.updatedAt)
  const existing = input.contextId
    ? workspace.projectContexts.find(context => context.id === input.contextId && context.projectId === input.projectId)
    : undefined

  if (input.contextId && !existing) throw new Error(`Unknown project context: ${input.contextId}`)

  if (existing) {
    existing.history.push(toProjectContextRevision(existing))
    existing.title = input.title
    existing.content = input.content
    existing.status = input.status ?? existing.status
    if (input.sourceTaskId !== undefined) existing.sourceTaskId = input.sourceTaskId
    if (input.provenance !== undefined) existing.provenance = structuredClone(input.provenance)
    existing.revision += 1
    existing.updatedAt = updatedAt
    if (existing.status === 'confirmed') existing.confirmedAt ??= updatedAt
    else existing.confirmedAt = undefined
    replaceAgentWorkspace(workspace, storage)
    return structuredClone(existing)
  }

  const context: AgentProjectContext = {
    id: nanoid(),
    projectId: input.projectId,
    title: input.title,
    content: input.content,
    status: input.status ?? 'pending',
    revision: 1,
    history: [],
    ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
    ...(input.provenance ? { provenance: structuredClone(input.provenance) } : {}),
    createdAt: updatedAt,
    updatedAt,
    ...(input.status === 'confirmed' ? { confirmedAt: updatedAt } : {}),
  }
  workspace.projectContexts.push(context)
  replaceAgentWorkspace(workspace, storage)
  return structuredClone(context)
}

export function deleteProjectContext(
  ownerUserId: string,
  projectId: string,
  contextId: string,
  storage?: AgentStorage,
): boolean {
  const workspace = readAgentWorkspace(ownerUserId, storage)
  const nextContexts = workspace.projectContexts.filter(
    context => context.id !== contextId || context.projectId !== projectId,
  )
  if (nextContexts.length === workspace.projectContexts.length) return false
  workspace.projectContexts = nextContexts
  if (!workspace.projectContextTombstones.some(tombstone => tombstone.id === contextId)) {
    workspace.projectContextTombstones.push({ id: contextId, projectId, deletedAt: new Date().toISOString() })
  }
  replaceAgentWorkspace(workspace, storage)
  return true
}

export function confirmProjectContext(
  ownerUserId: string,
  projectId: string,
  contextId: string,
  storage?: AgentStorage,
): AgentProjectContext {
  const workspace = readAgentWorkspace(ownerUserId, storage)
  const context = workspace.projectContexts.find(
    candidate => candidate.id === contextId && candidate.projectId === projectId,
  )
  if (!context) throw new Error(`Unknown project context: ${contextId}`)

  const updatedAt = new Date().toISOString()
  context.history.push(toProjectContextRevision(context))
  context.status = 'confirmed'
  context.revision += 1
  context.confirmedAt = updatedAt
  context.updatedAt = updatedAt
  replaceAgentWorkspace(workspace, storage)
  return structuredClone(context)
}

function toProjectContextRevision(context: AgentProjectContext): AgentProjectContextRevision {
  return {
    revision: context.revision,
    title: context.title,
    content: context.content,
    status: context.status,
    ...(context.sourceTaskId ? { sourceTaskId: context.sourceTaskId } : {}),
    ...(context.provenance ? { provenance: structuredClone(context.provenance) } : {}),
    createdAt: context.updatedAt,
  }
}

export function rollbackProjectContext(
  ownerUserId: string,
  projectId: string,
  contextId: string,
  revision?: number,
  storage?: AgentStorage,
): AgentProjectContext {
  const workspace = readAgentWorkspace(ownerUserId, storage)
  const context = workspace.projectContexts.find(
    candidate => candidate.id === contextId && candidate.projectId === projectId,
  )
  if (!context) throw new Error(`Unknown project context: ${contextId}`)

  const target =
    revision === undefined ? context.history.at(-1) : context.history.find(candidate => candidate.revision === revision)
  if (!target) throw new Error(`Unknown project context revision: ${revision ?? 'previous'}`)

  context.history.push(toProjectContextRevision(context))
  context.title = target.title
  context.content = target.content
  context.status = target.status
  context.sourceTaskId = target.sourceTaskId
  context.provenance = target.provenance ? structuredClone(target.provenance) : undefined
  context.revision += 1
  context.updatedAt = new Date().toISOString()
  context.confirmedAt = target.status === 'confirmed' ? context.updatedAt : undefined
  replaceAgentWorkspace(workspace, storage)
  return structuredClone(context)
}

export function readAgentPreferences(ownerUserId: string, storage?: AgentStorage): AgentPreferences {
  return { ...readAgentWorkspace(ownerUserId, storage).preferences }
}

export function updateAgentPreferences(
  ownerUserId: string,
  update: Partial<AgentPreferences>,
  storage?: AgentStorage,
): AgentPreferences {
  const workspace = readAgentWorkspace(ownerUserId, storage)
  workspace.preferences = { ...workspace.preferences, ...update }
  replaceAgentWorkspace(workspace, storage)
  return { ...workspace.preferences }
}

export function createAgentStore(storage: AgentStorage): AgentStore {
  return {
    readWorkspace: ownerUserId => readAgentWorkspace(ownerUserId, storage),
    createConversation: input => createAgentConversation(input, storage),
    appendTurn: input => appendAgentTurn(input, storage),
    setMessageAttachments: input => setAgentMessageAttachments(input, storage),
    getProjectConversations: (ownerUserId, projectId) => getProjectConversations(ownerUserId, projectId, storage),
    getConversation: (ownerUserId, conversationId) => getConversation(ownerUserId, conversationId, storage),
    updateTaskProgress: input => updateTaskProgress(input, storage),
    recordPlanResult: input => recordAgentPlanResult(input, storage),
    recordTaskQuestion: input => recordAgentTaskQuestion(input, storage),
    recordTaskPlan: input => recordAgentTaskPlan(input, storage),
    recordRun: input => recordAgentRun(input, storage),
    recordRunRollback: input => recordAgentRunRollback(input, storage),
    upsertProjectContext: input => upsertProjectContext(input, storage),
    deleteProjectContext: (ownerUserId, projectId, contextId) =>
      deleteProjectContext(ownerUserId, projectId, contextId, storage),
    confirmProjectContext: (ownerUserId, projectId, contextId) =>
      confirmProjectContext(ownerUserId, projectId, contextId, storage),
    rollbackProjectContext: (ownerUserId, projectId, contextId, revision) =>
      rollbackProjectContext(ownerUserId, projectId, contextId, revision, storage),
    readPreferences: ownerUserId => readAgentPreferences(ownerUserId, storage),
    updatePreferences: (ownerUserId, update) => updateAgentPreferences(ownerUserId, update, storage),
    subscribe: (ownerUserId, listener) => subscribeAgentWorkspace(ownerUserId, listener),
  }
}
