import { z } from 'zod'
import { agentSkillTraceSchema } from './agent-skill-trace.js'

const identifierSchema = z.string().trim().min(1).max(160)
const timestampSchema = z.string().datetime({ offset: true })

function addDuplicateIdIssues(
  items: ReadonlyArray<{ id: string }>,
  context: z.RefinementCtx,
  collection: string,
  message: string,
): void {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      context.addIssue({ code: 'custom', path: [collection, index, 'id'], message })
    }
    seen.add(item.id)
  })
}

const attachmentSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(255),
    scope: z.enum(['conversation', 'project']),
    mimeType: z.string().trim().min(1).max(255).optional(),
    type: z.string().trim().min(1).max(120).optional(),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(20 * 1024 * 1024)
      .optional(),
    projectId: z.uuid(),
    conversationId: identifierSchema,
    createdAt: timestampSchema,
  })
  .strict()

const messageSchema = z
  .object({
    id: identifierSchema,
    taskId: identifierSchema.optional(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(16_000),
    attachments: z.array(attachmentSchema).max(12),
    createdAt: timestampSchema,
  })
  .strict()

const stageSchema = z
  .object({
    id: z.enum(['understand-requirements', 'plan-layout', 'bind-data', 'preview-check']),
    title: z.string().trim().min(1).max(120),
    status: z.enum(['pending', 'waiting', 'running', 'complete', 'failed']),
    detail: z.string().max(2_000).optional(),
  })
  .strict()

const usageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .strict()

const costAmountSchema = z.number().nonnegative().max(1_000_000_000)

const runCostSchema = z
  .object({
    amount: costAmountSchema.optional(),
    currency: z.string().trim().min(1).max(12).optional(),
    accuracy: z.enum(['actual', 'estimated', 'billing_indeterminate']).optional(),
    minimumAmount: costAmountSchema.optional(),
    maximumAmount: costAmountSchema.optional(),
  })
  .strict()
  .superRefine((cost, context) => {
    if (
      cost.minimumAmount !== undefined &&
      cost.maximumAmount !== undefined &&
      cost.minimumAmount > cost.maximumAmount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minimumAmount'],
        message: 'Agent run minimum cost cannot exceed its maximum cost',
      })
    }
  })

const taskRunSchema = z
  .object({
    operationId: identifierSchema,
    status: z.enum([
      'planning',
      'running',
      'paused',
      'prepared',
      'committed',
      'stale',
      'failed',
      'canceled',
      'indeterminate',
    ]),
    outcome: z.json().optional(),
    receipt: z.json().optional(),
    cost: runCostSchema.optional(),
    trace: agentSkillTraceSchema.optional(),
    rollback: z.json().optional(),
    rolledBackAt: timestampSchema.optional(),
    rollbackReceipt: z.json().optional(),
  })
  .strict()

const taskPlanStepSchema = z
  .object({
    id: identifierSchema,
    title: z.string().trim().min(1).max(200),
    status: z.enum(['pending', 'running', 'complete', 'failed', 'canceled']),
    detail: z.string().max(2_000).optional(),
  })
  .strict()

const taskPlanSchema = z
  .object({
    summary: z.string().trim().min(1).max(2_000),
    steps: z.array(taskPlanStepSchema).min(1).max(24),
  })
  .strict()
  .superRefine((plan, context) => {
    if (new Set(plan.steps.map(step => step.id)).size !== plan.steps.length) {
      context.addIssue({ code: 'custom', path: ['steps'], message: 'Agent plan step ids must be unique' })
    }
  })

const pendingQuestionSchema = z
  .object({
    id: identifierSchema,
    messageId: identifierSchema,
    prompt: z.string().trim().min(1).max(4_000),
    askedAt: timestampSchema,
  })
  .strict()

const taskV1Schema = z
  .object({
    id: identifierSchema,
    title: z.string().trim().min(1).max(200),
    status: z.enum(['waiting', 'waiting_user', 'paused', 'running', 'complete', 'failed', 'canceled']),
    stages: z.array(stageSchema).length(4),
    plan: taskPlanSchema.optional(),
    pendingQuestion: pendingQuestionSchema.optional(),
    usage: usageSchema.optional(),
    run: taskRunSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((task, context) => {
    const stageIds = new Set(task.stages.map(stage => stage.id))
    if (stageIds.size !== 4) {
      context.addIssue({ code: 'custom', path: ['stages'], message: 'Agent task stages must be unique' })
    }
  })

const conversationV1Schema = z
  .object({
    id: identifierSchema,
    ownerUserId: z.uuid(),
    projectId: z.uuid(),
    projectName: z.string().trim().max(160).optional(),
    visibility: z.literal('private'),
    title: z.string().trim().min(1).max(200),
    messages: z.array(messageSchema).max(500),
    tasks: z.array(taskV1Schema).max(200),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((conversation, context) => {
    addDuplicateIdIssues(conversation.tasks, context, 'tasks', 'Agent task ids must be unique within a conversation')
    addDuplicateIdIssues(
      conversation.messages,
      context,
      'messages',
      'Agent message ids must be unique within a conversation',
    )
    const taskIds = new Set(conversation.tasks.map(task => task.id))
    const messages = new Map(conversation.messages.map(message => [message.id, message]))
    conversation.messages.forEach((message, index) => {
      if (message.taskId && !taskIds.has(message.taskId)) {
        context.addIssue({
          code: 'custom',
          path: ['messages', index, 'taskId'],
          message: 'Agent message task must belong to its conversation',
        })
      }
    })
    conversation.tasks.forEach((task, index) => {
      if (!task.pendingQuestion) return
      const questionMessage = messages.get(task.pendingQuestion.messageId)
      if (!questionMessage || questionMessage.role !== 'assistant' || questionMessage.taskId !== task.id) {
        context.addIssue({
          code: 'custom',
          path: ['tasks', index, 'pendingQuestion'],
          message: 'Agent pending question must reference an assistant message from the same task',
        })
      }
    })
  })

const semanticTaskV2Schema = z
  .object({
    id: identifierSchema,
    title: z.string().trim().min(1).max(200),
    taskRunId: z.uuid().optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

const taskV2Schema = z.union([semanticTaskV2Schema, taskV1Schema])

const conversationV2Schema = z
  .object({
    id: identifierSchema,
    ownerUserId: z.uuid(),
    projectId: z.uuid(),
    projectName: z.string().trim().max(160).optional(),
    visibility: z.literal('private'),
    title: z.string().trim().min(1).max(200),
    messages: z.array(messageSchema).max(500),
    tasks: z.array(taskV2Schema).max(200),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((conversation, context) => {
    addDuplicateIdIssues(conversation.tasks, context, 'tasks', 'Agent task ids must be unique within a conversation')
    addDuplicateIdIssues(
      conversation.messages,
      context,
      'messages',
      'Agent message ids must be unique within a conversation',
    )
    const taskIds = new Set(conversation.tasks.map(task => task.id))
    const messages = new Map(conversation.messages.map(message => [message.id, message]))
    conversation.messages.forEach((message, index) => {
      if (message.taskId && !taskIds.has(message.taskId)) {
        context.addIssue({
          code: 'custom',
          path: ['messages', index, 'taskId'],
          message: 'Agent message task must belong to its conversation',
        })
      }
    })
    conversation.tasks.forEach((task, index) => {
      if (!('pendingQuestion' in task) || !task.pendingQuestion) return
      const questionMessage = messages.get(task.pendingQuestion.messageId)
      if (!questionMessage || questionMessage.role !== 'assistant' || questionMessage.taskId !== task.id) {
        context.addIssue({
          code: 'custom',
          path: ['tasks', index, 'pendingQuestion'],
          message: 'Agent pending question must reference an assistant message from the same task',
        })
      }
    })
  })

const writableSemanticTaskV2Schema = semanticTaskV2Schema.omit({ taskRunId: true }).strict()
const writableTaskV2Schema = z.union([writableSemanticTaskV2Schema, taskV1Schema])

const writableConversationV2Schema = z
  .object({
    id: identifierSchema,
    ownerUserId: z.uuid(),
    projectId: z.uuid(),
    projectName: z.string().trim().max(160).optional(),
    visibility: z.literal('private'),
    title: z.string().trim().min(1).max(200),
    messages: z.array(messageSchema).max(500),
    tasks: z.array(writableTaskV2Schema).max(200),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((conversation, context) => {
    addDuplicateIdIssues(conversation.tasks, context, 'tasks', 'Agent task ids must be unique within a conversation')
    addDuplicateIdIssues(
      conversation.messages,
      context,
      'messages',
      'Agent message ids must be unique within a conversation',
    )
    const taskIds = new Set(conversation.tasks.map(task => task.id))
    const messages = new Map(conversation.messages.map(message => [message.id, message]))
    conversation.messages.forEach((message, index) => {
      if (message.taskId && !taskIds.has(message.taskId)) {
        context.addIssue({
          code: 'custom',
          path: ['messages', index, 'taskId'],
          message: 'Agent message task must belong to its conversation',
        })
      }
    })
    conversation.tasks.forEach((task, index) => {
      if (!('pendingQuestion' in task) || !task.pendingQuestion) return
      const questionMessage = messages.get(task.pendingQuestion.messageId)
      if (!questionMessage || questionMessage.role !== 'assistant' || questionMessage.taskId !== task.id) {
        context.addIssue({
          code: 'custom',
          path: ['tasks', index, 'pendingQuestion'],
          message: 'Agent pending question must reference an assistant message from the same task',
        })
      }
    })
  })

const contextRevisionSchema = z
  .object({
    revision: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(8_000),
    status: z.enum(['pending', 'confirmed']),
    sourceTaskId: identifierSchema.optional(),
    provenance: z
      .object({
        origin: z.enum(['agent_task', 'manual']),
        sourceKinds: z
          .array(z.enum(['user_request', 'agent_plan', 'agent_result']))
          .min(1)
          .max(3),
      })
      .strict()
      .optional(),
    createdAt: timestampSchema,
  })
  .strict()

const projectContextSchema = z
  .object({
    id: identifierSchema,
    projectId: z.uuid(),
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(8_000),
    status: z.enum(['pending', 'confirmed']),
    revision: z.number().int().positive(),
    history: z.array(contextRevisionSchema).max(50),
    sourceTaskId: identifierSchema.optional(),
    provenance: z
      .object({
        origin: z.enum(['agent_task', 'manual']),
        sourceKinds: z
          .array(z.enum(['user_request', 'agent_plan', 'agent_result']))
          .min(1)
          .max(3),
      })
      .strict()
      .optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    confirmedAt: timestampSchema.optional(),
  })
  .strict()

const projectContextTombstoneSchema = z
  .object({
    id: identifierSchema,
    projectId: z.uuid(),
    deletedAt: timestampSchema,
  })
  .strict()

export const agentProjectWorkspacePayloadV1Schema = z
  .object({
    version: z.literal(1),
    ownerUserId: z.uuid(),
    projectId: z.uuid(),
    conversations: z.array(conversationV1Schema).max(100),
    projectContexts: z.array(projectContextSchema).max(100),
    projectContextTombstones: z.array(projectContextTombstoneSchema).max(200).optional(),
  })
  .strict()
  .superRefine((workspace, context) => {
    addDuplicateIdIssues(workspace.conversations, context, 'conversations', 'Agent conversation ids must be unique')
  })

export const agentProjectWorkspacePayloadV2Schema = z
  .object({
    version: z.literal(2),
    ownerUserId: z.uuid(),
    projectId: z.uuid(),
    conversations: z.array(conversationV2Schema).max(100),
    projectContexts: z.array(projectContextSchema).max(100),
    projectContextTombstones: z.array(projectContextTombstoneSchema).max(200).optional(),
  })
  .strict()
  .superRefine((workspace, context) => {
    addDuplicateIdIssues(workspace.conversations, context, 'conversations', 'Agent conversation ids must be unique')
  })

const writableAgentProjectWorkspacePayloadV2Schema = z
  .object({
    version: z.literal(2),
    ownerUserId: z.uuid(),
    projectId: z.uuid(),
    conversations: z.array(writableConversationV2Schema).max(100),
    projectContexts: z.array(projectContextSchema).max(100),
    projectContextTombstones: z.array(projectContextTombstoneSchema).max(200).optional(),
  })
  .strict()
  .superRefine((workspace, context) => {
    addDuplicateIdIssues(workspace.conversations, context, 'conversations', 'Agent conversation ids must be unique')
  })

export const agentProjectWorkspacePayloadSchema = z.discriminatedUnion('version', [
  agentProjectWorkspacePayloadV1Schema,
  agentProjectWorkspacePayloadV2Schema,
])

export type AgentProjectWorkspacePayload = z.infer<typeof agentProjectWorkspacePayloadSchema>
export type AgentProjectWorkspacePayloadV2 = z.infer<typeof agentProjectWorkspacePayloadV2Schema>

function assertAgentProjectWorkspaceIdentity(
  payload: AgentProjectWorkspacePayload,
  ownerUserId: string,
  projectId: string,
): void {
  const taskIds = new Set(payload.conversations.flatMap(conversation => conversation.tasks.map(task => task.id)))
  const identityMatches =
    payload.ownerUserId === ownerUserId &&
    payload.projectId === projectId &&
    payload.conversations.every(
      conversation =>
        conversation.ownerUserId === ownerUserId &&
        conversation.projectId === projectId &&
        conversation.messages.every(message =>
          message.attachments.every(
            attachment => attachment.projectId === projectId && attachment.conversationId === conversation.id,
          ),
        ),
    ) &&
    payload.projectContexts.every(
      projectContext =>
        projectContext.projectId === projectId &&
        (projectContext.sourceTaskId === undefined || taskIds.has(projectContext.sourceTaskId)) &&
        projectContext.history.every(
          revision => revision.sourceTaskId === undefined || taskIds.has(revision.sourceTaskId),
        ),
    ) &&
    (payload.projectContextTombstones ?? []).every(tombstone => tombstone.projectId === projectId)
  if (!identityMatches) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: 'Agent workspace identity does not match the authenticated project scope',
      },
    ])
  }
}

export function parseAgentProjectWorkspacePayload(
  value: unknown,
  ownerUserId: string,
  projectId: string,
): AgentProjectWorkspacePayload {
  const payload = agentProjectWorkspacePayloadSchema.parse(value)
  assertAgentProjectWorkspaceIdentity(payload, ownerUserId, projectId)
  return payload
}

/**
 * Browser CAS writes only accept V2. V1 remains decodable so historical
 * workspaces stay readable, but writing one back would preserve client-owned
 * lifecycle fields that are no longer authoritative.
 */
export function parseWritableAgentProjectWorkspacePayload(
  value: unknown,
  ownerUserId: string,
  projectId: string,
): AgentProjectWorkspacePayloadV2 {
  const payload: AgentProjectWorkspacePayloadV2 = writableAgentProjectWorkspacePayloadV2Schema.parse(value)
  assertAgentProjectWorkspaceIdentity(payload, ownerUserId, projectId)
  return payload
}

/** Preserve server-owned task-run identities across browser-owned workspace edits. */
export function preserveAgentWorkspaceTaskRunProjections(
  payload: AgentProjectWorkspacePayloadV2,
  persisted: AgentProjectWorkspacePayload,
): AgentProjectWorkspacePayloadV2 {
  if (persisted.version !== 2) return payload
  const taskRunIds = new Map<string, string>()
  for (const conversation of persisted.conversations) {
    for (const task of conversation.tasks) {
      if ('taskRunId' in task && task.taskRunId) {
        taskRunIds.set(`${conversation.id}\u0000${task.id}`, task.taskRunId)
      }
    }
  }
  const submittedTaskKeys = new Set(
    payload.conversations.flatMap(conversation => conversation.tasks.map(task => `${conversation.id}\u0000${task.id}`)),
  )
  for (const taskKey of taskRunIds.keys()) {
    if (!submittedTaskKeys.has(taskKey)) {
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['conversations'],
          message: 'Agent workspace cannot remove or change the identity of a server-bound task',
        },
      ])
    }
  }
  return {
    ...payload,
    conversations: payload.conversations.map(conversation => ({
      ...conversation,
      tasks: conversation.tasks.map(task => {
        const taskRunId = taskRunIds.get(`${conversation.id}\u0000${task.id}`)
        return taskRunId && !('stages' in task) ? { ...task, taskRunId } : task
      }),
    })),
  }
}

/**
 * V1 tasks may be copied into V2 as compatibility data, but every task field is
 * a server-owned projection. Browser writes may retain the same task identity
 * while editing its surrounding conversation; the persisted task always wins.
 */
export function preserveAgentWorkspaceLegacyTasks(
  payload: AgentProjectWorkspacePayloadV2,
  persisted: AgentProjectWorkspacePayload,
): AgentProjectWorkspacePayloadV2 {
  type LegacyTask = z.infer<typeof taskV1Schema>
  const persistedLegacyTasks = new Map<string, LegacyTask>()
  for (const conversation of persisted.conversations) {
    for (const task of conversation.tasks) {
      if ('stages' in task) persistedLegacyTasks.set(`${conversation.id}\u0000${task.id}`, task)
    }
  }
  const submittedLegacyTasks = new Map<string, LegacyTask>()
  for (const conversation of payload.conversations) {
    for (const task of conversation.tasks) {
      if ('stages' in task) submittedLegacyTasks.set(`${conversation.id}\u0000${task.id}`, task)
    }
  }
  for (const [taskKey, task] of persistedLegacyTasks) {
    const submitted = submittedLegacyTasks.get(taskKey)
    if (!submitted || submitted.run?.operationId !== task.run?.operationId) {
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['conversations'],
          message: 'Agent workspace cannot remove, move, replace, regress, or rewrite a legacy task',
        },
      ])
    }
  }
  for (const taskKey of submittedLegacyTasks.keys()) {
    if (!persistedLegacyTasks.has(taskKey)) {
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['conversations'],
          message: 'Agent workspace cannot fabricate a legacy task',
        },
      ])
    }
  }
  return {
    ...payload,
    conversations: payload.conversations.map(conversation => ({
      ...conversation,
      tasks: conversation.tasks.map(task => {
        if (!('stages' in task)) return task
        return persistedLegacyTasks.get(`${conversation.id}\u0000${task.id}`) ?? task
      }),
    })),
  }
}

export type AgentWorkspaceTaskRunProjectionResult =
  | { status: 'bound' | 'already_bound'; payload: AgentProjectWorkspacePayloadV2 }
  | { status: 'conflict' | 'legacy' | 'not_found' }

/**
 * Pure, server-owned projection update. It can only fill an empty taskRunId;
 * the same value is idempotent and a different value can never replace it.
 */
export function bindAgentWorkspaceTaskRunProjection(
  payload: AgentProjectWorkspacePayload,
  input: { conversationId: string; taskId: string; taskRunId: string },
): AgentWorkspaceTaskRunProjectionResult {
  if (payload.version !== 2) return { status: 'legacy' }
  const conversationIndex = payload.conversations.findIndex(conversation => conversation.id === input.conversationId)
  if (conversationIndex === -1) return { status: 'not_found' }
  const conversation = payload.conversations[conversationIndex]
  const taskIndex = conversation?.tasks.findIndex(task => task.id === input.taskId) ?? -1
  if (!conversation || taskIndex === -1) return { status: 'not_found' }
  const task = conversation.tasks[taskIndex]
  if (!task) return { status: 'not_found' }
  if ('stages' in task) return { status: 'legacy' }
  if (task.taskRunId === input.taskRunId) return { status: 'already_bound', payload }
  if (task.taskRunId) return { status: 'conflict' }

  const tasks = conversation.tasks.slice()
  tasks[taskIndex] = { ...task, taskRunId: input.taskRunId }
  const conversations = payload.conversations.slice()
  conversations[conversationIndex] = { ...conversation, tasks }
  return { status: 'bound', payload: { ...payload, conversations } }
}
