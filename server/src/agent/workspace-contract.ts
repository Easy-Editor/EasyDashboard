import { z } from 'zod'
import { agentSkillTraceSchema } from './agent-skill-trace.js'

const identifierSchema = z.string().trim().min(1).max(160)
const timestampSchema = z.string().datetime({ offset: true })

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

const taskSchema = z
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

const conversationSchema = z
  .object({
    id: identifierSchema,
    ownerUserId: z.uuid(),
    projectId: z.uuid(),
    projectName: z.string().trim().max(160).optional(),
    visibility: z.literal('private'),
    title: z.string().trim().min(1).max(200),
    messages: z.array(messageSchema).max(500),
    tasks: z.array(taskSchema).max(200),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((conversation, context) => {
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

export const agentProjectWorkspacePayloadSchema = z
  .object({
    version: z.literal(1),
    ownerUserId: z.uuid(),
    projectId: z.uuid(),
    conversations: z.array(conversationSchema).max(100),
    projectContexts: z.array(projectContextSchema).max(100),
    projectContextTombstones: z.array(projectContextTombstoneSchema).max(200).optional(),
  })
  .strict()

export type AgentProjectWorkspacePayload = z.infer<typeof agentProjectWorkspacePayloadSchema>

export function parseAgentProjectWorkspacePayload(
  value: unknown,
  ownerUserId: string,
  projectId: string,
): AgentProjectWorkspacePayload {
  const payload = agentProjectWorkspacePayloadSchema.parse(value)
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
  return payload
}
