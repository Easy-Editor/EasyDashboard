import { ApiError, apiRequest, jsonBody } from '@/api/client'
import { agentAttachmentContentType } from './attachments'
import type {
  AgentAttachmentInput,
  AgentConversation,
  AgentRunCost,
  AgentRunTrace,
  AgentSelectionContext,
  AgentTaskPlan,
  AgentWorkspaceRemoteRecord,
  ProjectContextStatus,
} from './types'

export type AgentPlanUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type AgentBudgetUsageItem = {
  usedMicros: number
  limitMicros: number
  ratio: number
  state: 'ok' | 'warning' | 'hard_stop'
}

export type AgentBudgetUsage = {
  warningRatio: number
  task: AgentBudgetUsageItem
  projectMonth: AgentBudgetUsageItem
}

export async function getAgentBudgetUsage(projectId: string, taskId: string): Promise<AgentBudgetUsage> {
  const query = new URLSearchParams({ projectId, taskId })
  return apiRequest<AgentBudgetUsage>(`/api/agent/config/usage?${query}`)
}

export type AgentPlanResponse = {
  message: string
  usage?: AgentPlanUsage
}

export type AgentPlanInput = {
  projectId: string
  conversationId: string
  taskId: string
  prompt: string
  attachments?: AgentAttachmentInput[]
  projectContext?: Array<{
    title: string
    content: string
    status: ProjectContextStatus
  }>
  selectionContext?: AgentSelectionContext
}

function trimmed(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim().slice(0, maxLength)
  return normalized || undefined
}

function selectionDimension(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0 || value > 32_768) return undefined
  return Math.round(value)
}

export function compileAgentSelectionContext(
  selectionContext: AgentSelectionContext | undefined,
): AgentSelectionContext | undefined {
  if (!selectionContext) return undefined

  const pageId = trimmed(selectionContext.pageId, 160)
  const pageLabel = trimmed(selectionContext.pageLabel, 160)
  const selectedIds = new Set<string>()
  const selectedRefs = (selectionContext.selectedRefs ?? [])
    .flatMap(ref => {
      const id = trimmed(ref.id, 160)
      const title = trimmed(ref.title, 160)
      const componentName = trimmed(ref.componentName, 120)
      if (!id || !title || !componentName || selectedIds.has(id)) return []
      selectedIds.add(id)
      return [{ id, title, componentName }]
    })
    .slice(0, 12)
  const width = selectionDimension(selectionContext.viewport?.width)
  const height = selectionDimension(selectionContext.viewport?.height)
  const viewport =
    width === undefined && height === undefined
      ? undefined
      : {
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
        }

  if (!pageId && !pageLabel && selectedRefs.length === 0 && !viewport) return undefined
  return {
    ...(pageId ? { pageId } : {}),
    ...(pageLabel ? { pageLabel } : {}),
    selectedRefs,
    ...(viewport ? { viewport } : {}),
  }
}

export function compileAgentPlanPayload(input: AgentPlanInput) {
  const attachmentKeys = new Set<string>()
  const attachments = [...(input.attachments ?? [])]
    .reverse()
    .flatMap(attachment => {
      const name = trimmed(attachment.name, 255)
      if (!name) return []
      const key = `${attachment.scope}:${name}:${attachment.mimeType ?? attachment.type ?? ''}:${attachment.size ?? ''}`
      if (attachmentKeys.has(key)) return []
      attachmentKeys.add(key)
      const id = trimmed(attachment.id, 160)
      const mimeType = trimmed(attachment.mimeType, 255)
      const type = trimmed(attachment.type, 120)
      return [
        {
          ...(id ? { id } : {}),
          name,
          scope: attachment.scope,
          ...(mimeType ? { mimeType } : {}),
          ...(type ? { type } : {}),
          ...(attachment.size === undefined ||
          !Number.isFinite(attachment.size) ||
          attachment.size < 0 ||
          attachment.size > 100 * 1024 * 1024
            ? {}
            : { size: Math.trunc(attachment.size) }),
        },
      ]
    })
    .slice(0, 12)
    .reverse()

  const contextKeys = new Set<string>()
  const projectContext = [...(input.projectContext ?? [])]
    .reverse()
    .flatMap(context => {
      const title = trimmed(context.title, 160)
      const content = trimmed(context.content, 2_000)
      if (!title || !content) return []
      const key = `${context.status}:${title}:${content}`
      if (contextKeys.has(key)) return []
      contextKeys.add(key)
      return [{ title, content, status: context.status }]
    })
    .slice(0, 24)
    .reverse()

  const selectionContext = compileAgentSelectionContext(input.selectionContext)

  return {
    projectId: input.projectId,
    conversationId: input.conversationId,
    taskId: input.taskId,
    prompt: input.prompt.trim().slice(0, 4_000),
    attachments,
    projectContext,
    ...(selectionContext ? { selectionContext } : {}),
  }
}

export async function requestAgentPlan(input: AgentPlanInput): Promise<AgentPlanResponse> {
  return apiRequest<AgentPlanResponse>('/api/agent/plan', {
    method: 'POST',
    body: jsonBody(compileAgentPlanPayload(input)),
  })
}

export type AgentFileSelection = { file: File; scope: 'conversation' | 'project'; idempotencyKey: string }

type AgentAssetUpload =
  | {
      id: string
      path: string
      signedUrl: string
      alreadyCompleted?: false
    }
  | {
      id: string
      path: string
      alreadyCompleted: true
      asset: { id: string; originalName?: string; contentType?: string; size?: number }
    }

export async function uploadAgentFile(
  projectId: string,
  conversationId: string | undefined,
  selection: AgentFileSelection,
): Promise<AgentAttachmentInput> {
  const file = selection.file
  const contentType = agentAttachmentContentType(file)
  if (!contentType) throw new Error('不支持的附件格式')
  const response = await apiRequest<{ upload: AgentAssetUpload }>(
    `/api/projects/${encodeURIComponent(projectId)}/agent-assets/upload`,
    {
      method: 'POST',
      body: jsonBody({
        idempotencyKey: selection.idempotencyKey,
        scope: selection.scope,
        ...(selection.scope === 'conversation' ? { conversationId } : {}),
        name: file.name,
        contentType,
        size: file.size,
      }),
    },
  )
  if (response.upload.alreadyCompleted) {
    return {
      id: response.upload.asset.id,
      name: response.upload.asset.originalName ?? file.name,
      mimeType: response.upload.asset.contentType ?? contentType,
      size: response.upload.asset.size ?? file.size,
      scope: selection.scope,
    }
  }
  const uploaded = await fetch(response.upload.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  })
  if (!uploaded.ok) throw new Error(`附件上传失败（${uploaded.status}）`)
  const completed = await apiRequest<{
    asset: { id: string; originalName?: string; contentType?: string; size?: number }
  }>(`/api/projects/${encodeURIComponent(projectId)}/agent-assets/complete`, {
    method: 'POST',
    body: jsonBody({ id: response.upload.id, path: response.upload.path }),
  })
  return {
    id: completed.asset.id,
    name: completed.asset.originalName ?? file.name,
    mimeType: completed.asset.contentType ?? contentType,
    size: completed.asset.size ?? file.size,
    scope: selection.scope,
  }
}

export async function uploadAgentFiles(
  projectId: string,
  conversationId: string | undefined,
  selections: readonly AgentFileSelection[],
): Promise<AgentAttachmentInput[]> {
  return Promise.all(selections.map(selection => uploadAgentFile(projectId, conversationId, selection)))
}

export type AgentRunStatus =
  | 'planning'
  | 'running'
  | 'paused'
  | 'prepared'
  | 'committed'
  | 'stale'
  | 'failed'
  | 'canceled'
  | 'indeterminate'
export type { AgentRunCost } from './types'

export type AgentRunControl = {
  state: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'canceled' | 'indeterminate'
  desiredState: 'running' | 'paused' | 'canceled'
  canPause: boolean
  canResume: boolean
  canCancel: boolean
}

export type AgentRunPendingQuestion = {
  turnId: string
  message: string
  question: {
    id: string
    text: string
  }
  plan?: AgentTaskPlan
  usage?: AgentPlanUsage
}

export type AgentRun = {
  operationId: string
  taskId?: string
  status: AgentRunStatus
  message?: string
  usage?: AgentPlanUsage
  outcome?: unknown
  receipt?: unknown
  cost?: AgentRunCost
  trace?: AgentRunTrace
  rollback?: unknown
  rolledBackAt?: string
  rollbackReceipt?: unknown
  completedAt?: string | null
  control?: AgentRunControl
  pendingQuestion?: AgentRunPendingQuestion
}

export type AgentTurnInput = AgentPlanInput & {
  turnId: string
}

export type AgentWaitingUserTurnResult = {
  kind: 'waiting_user'
  turnId: string
  taskId: string
  message: string
  question: {
    id: string
    text: string
  }
  plan?: AgentTaskPlan
  usage?: AgentPlanUsage
  cost?: AgentRunCost
}

export type AgentRunTurnResult = {
  kind: 'run'
  turnId: string
  taskId: string
  plan?: AgentTaskPlan
  run: AgentRun
}

export type AgentTurnResult = AgentWaitingUserTurnResult | AgentRunTurnResult

function normalizeRunTrace(value: unknown): AgentRunTrace | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (
    typeof raw.promptBundleId !== 'string' ||
    typeof raw.promptBundleVersion !== 'string' ||
    typeof raw.promptBundleHash !== 'string' ||
    !Array.isArray(raw.skills)
  ) {
    return undefined
  }
  const skills = raw.skills.filter((skill): skill is string => typeof skill === 'string' && Boolean(skill.trim()))
  return {
    promptBundleId: raw.promptBundleId,
    promptBundleVersion: raw.promptBundleVersion,
    promptBundleHash: raw.promptBundleHash,
    skills: [...new Set(skills.map(skill => skill.trim()))],
  }
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function normalizeRunCost(value: unknown): AgentRunCost | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const amount = optionalNumber(raw.amount)
  const minimumAmount = optionalNumber(raw.minimumAmount)
  const maximumAmount = optionalNumber(raw.maximumAmount)
  const currency = typeof raw.currency === 'string' && raw.currency.trim() ? raw.currency.trim() : undefined
  const accuracy =
    raw.accuracy === 'actual' || raw.accuracy === 'estimated' || raw.accuracy === 'billing_indeterminate'
      ? raw.accuracy
      : undefined
  if (
    amount === undefined &&
    minimumAmount === undefined &&
    maximumAmount === undefined &&
    currency === undefined &&
    accuracy === undefined
  ) {
    return undefined
  }
  return {
    ...(amount === undefined ? {} : { amount }),
    ...(currency === undefined ? {} : { currency }),
    ...(accuracy === undefined ? {} : { accuracy }),
    ...(minimumAmount === undefined ? {} : { minimumAmount }),
    ...(maximumAmount === undefined ? {} : { maximumAmount }),
  }
}

function formatCostAmount(amount: number, currency?: string): string {
  const value = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })
  const currencyCode = currency?.trim().toUpperCase()
  return currencyCode === 'USD' ? `$${value}` : `${value} ${currencyCode ?? ''}`.trim()
}

export function formatAgentRunCost(cost: AgentRunCost | undefined): string | null {
  if (!cost) return null
  if (cost.accuracy === 'billing_indeterminate') {
    const upperBound = cost.maximumAmount ?? cost.amount
    return upperBound === undefined ? '费用待确认' : `预计不超过 ${formatCostAmount(upperBound, cost.currency)}`
  }
  if (cost.amount === undefined) return null
  const amount = formatCostAmount(cost.amount, cost.currency)
  return cost.accuracy === 'estimated' ? `约 ${amount}` : amount
}

function normalizeRun(raw: Record<string, unknown>): AgentRun {
  const rawStatus = String(raw.status ?? '')
  const status: AgentRunStatus =
    rawStatus === 'committed'
      ? 'committed'
      : rawStatus === 'paused'
        ? 'paused'
        : rawStatus === 'canceled'
          ? 'canceled'
          : rawStatus === 'prepared'
            ? 'prepared'
            : rawStatus === 'indeterminate'
              ? 'indeterminate'
              : rawStatus === 'rejected_stale'
                ? 'stale'
                : rawStatus === 'failed_not_applied' || rawStatus === 'failed'
                  ? 'failed'
                  : rawStatus === 'planning'
                    ? 'planning'
                    : 'running'
  const outcome = raw.outcome && typeof raw.outcome === 'object' ? (raw.outcome as Record<string, unknown>) : undefined
  const cost = normalizeRunCost(outcome?.cost ?? raw.cost)
  const trace = normalizeRunTrace(raw.trace)
  const control = normalizeRunControl(raw.control)
  const pendingQuestion = normalizePendingQuestion(raw.pendingQuestion)
  return {
    operationId: String(raw.operationId),
    ...(typeof raw.taskId === 'string' && raw.taskId ? { taskId: raw.taskId } : {}),
    status,
    ...(typeof raw.message === 'string' && raw.message.trim() ? { message: raw.message.trim() } : {}),
    ...(raw.usage && typeof raw.usage === 'object' ? { usage: raw.usage as AgentPlanUsage } : {}),
    ...(trace ? { trace } : {}),
    ...(outcome
      ? {
          outcome,
          receipt: raw.receipt ?? outcome.receipt ?? outcome.commitReceipt,
          ...(cost ? { cost } : {}),
          rollback: raw.rollback ?? outcome.rollback ?? raw.rollbackRevisionId,
        }
      : {
          ...(cost ? { cost } : {}),
          ...(raw.rollbackRevisionId ? { rollback: raw.rollbackRevisionId } : {}),
        }),
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    ...(typeof raw.rolledBackAt === 'string' ? { rolledBackAt: raw.rolledBackAt } : {}),
    ...(raw.rollbackReceipt === undefined ? {} : { rollbackReceipt: raw.rollbackReceipt }),
    ...(control ? { control } : {}),
    ...(pendingQuestion ? { pendingQuestion } : {}),
  }
}

function normalizePendingQuestion(value: unknown): AgentRunPendingQuestion | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const question = raw.question
  const questionRecord = question && typeof question === 'object' ? (question as Record<string, unknown>) : undefined
  if (
    typeof raw.turnId !== 'string' ||
    !raw.turnId.trim() ||
    typeof raw.message !== 'string' ||
    !raw.message.trim() ||
    !questionRecord ||
    typeof questionRecord.id !== 'string' ||
    !questionRecord.id.trim() ||
    typeof questionRecord.text !== 'string' ||
    !questionRecord.text.trim()
  ) {
    return undefined
  }
  const normalizedPlan = normalizeTaskPlan(raw.plan)
  return {
    turnId: raw.turnId.trim(),
    message: raw.message.trim(),
    question: {
      id: questionRecord.id.trim(),
      text: questionRecord.text.trim(),
    },
    ...(normalizedPlan ? { plan: normalizedPlan } : {}),
    ...(raw.usage && typeof raw.usage === 'object' ? { usage: raw.usage as AgentPlanUsage } : {}),
  }
}

function normalizeRunControl(value: unknown): AgentRunControl | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const states = new Set<AgentRunControl['state']>([
    'queued',
    'running',
    'paused',
    'succeeded',
    'failed',
    'canceled',
    'indeterminate',
  ])
  const desiredStates = new Set<AgentRunControl['desiredState']>(['running', 'paused', 'canceled'])
  if (
    typeof raw.state !== 'string' ||
    !states.has(raw.state as AgentRunControl['state']) ||
    typeof raw.desiredState !== 'string' ||
    !desiredStates.has(raw.desiredState as AgentRunControl['desiredState']) ||
    typeof raw.canPause !== 'boolean' ||
    typeof raw.canResume !== 'boolean' ||
    typeof raw.canCancel !== 'boolean'
  ) {
    return undefined
  }
  return {
    state: raw.state as AgentRunControl['state'],
    desiredState: raw.desiredState as AgentRunControl['desiredState'],
    canPause: raw.canPause,
    canResume: raw.canResume,
    canCancel: raw.canCancel,
  }
}

function normalizeTaskPlan(value: unknown): AgentTaskPlan | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.summary !== 'string' || !Array.isArray(raw.steps)) return undefined
  const steps = raw.steps.flatMap(step => {
    if (!step || typeof step !== 'object') return []
    const candidate = step as Record<string, unknown>
    const status = candidate.status
    if (
      typeof candidate.id !== 'string' ||
      !candidate.id.trim() ||
      typeof candidate.title !== 'string' ||
      !candidate.title.trim() ||
      !isTaskPlanStepStatus(status)
    ) {
      return []
    }
    return [
      {
        id: candidate.id.trim(),
        title: candidate.title.trim(),
        status,
        ...(typeof candidate.detail === 'string' && candidate.detail.trim() ? { detail: candidate.detail.trim() } : {}),
      },
    ]
  })
  return { summary: raw.summary.trim(), steps }
}

function isTaskPlanStepStatus(value: unknown): value is AgentTaskPlan['steps'][number]['status'] {
  return (
    value === 'pending' || value === 'running' || value === 'complete' || value === 'failed' || value === 'canceled'
  )
}

function normalizePlanUsage(value: unknown): AgentPlanUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const promptTokens = optionalNumber(raw.promptTokens)
  const completionTokens = optionalNumber(raw.completionTokens)
  const totalTokens = optionalNumber(raw.totalTokens)
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) return undefined
  return {
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  }
}

function agentRunStartPayload(input: AgentPlanInput, turnId?: string) {
  const selectionContext = compileAgentSelectionContext(input.selectionContext)
  return {
    conversationId: input.conversationId,
    taskId: input.taskId,
    ...(turnId ? { turnId } : {}),
    prompt: input.prompt.trim().slice(0, 4_000),
    attachmentIds: selectAgentRunAttachmentIds(input.attachments ?? []),
    projectContext: input.projectContext ?? [],
    ...(selectionContext ? { selectionContext } : {}),
  }
}

function selectAgentRunAttachmentIds(attachments: readonly AgentAttachmentInput[]): string[] {
  const ids = new Set<string>()
  const prioritized = [
    ...attachments.filter(attachment => attachment.scope === 'conversation'),
    ...attachments.filter(attachment => attachment.scope !== 'conversation'),
  ]
  for (const attachment of prioritized) {
    const id = attachment.id?.trim()
    if (!id || ids.has(id)) continue
    ids.add(id)
    if (ids.size === 12) break
  }
  return [...ids]
}

const workspaceSyncRetryDelaysMs = [200, 400, 600] as const
const workspaceSyncRaceCodes = new Set(['AGENT_CONVERSATION_NOT_FOUND', 'AGENT_TASK_NOT_FOUND'])

function isWorkspaceSyncRaceError(reason: unknown): reason is ApiError {
  return reason instanceof ApiError && workspaceSyncRaceCodes.has(reason.code)
}

async function withWorkspaceSyncRaceRetry<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request()
    } catch (reason) {
      const delayMs = workspaceSyncRetryDelaysMs[attempt]
      if (!isWorkspaceSyncRaceError(reason) || delayMs === undefined) throw reason
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}

function normalizeAgentTurnResult(value: unknown, input: AgentTurnInput): AgentTurnResult {
  if (!value || typeof value !== 'object') throw new Error('Invalid Agent turn response')
  const raw = value as Record<string, unknown>
  const responseTurnId = typeof raw.turnId === 'string' && raw.turnId ? raw.turnId : input.turnId
  const responseTaskId = typeof raw.taskId === 'string' && raw.taskId ? raw.taskId : input.taskId
  if (responseTurnId !== input.turnId || responseTaskId !== input.taskId) {
    throw new Error('Agent turn response correlation mismatch')
  }

  if (raw.kind === 'waiting_user') {
    const question = raw.question && typeof raw.question === 'object' ? (raw.question as Record<string, unknown>) : null
    const questionId = typeof question?.id === 'string' ? question.id.trim() : ''
    const questionText = typeof question?.text === 'string' ? question.text.trim() : ''
    const message = typeof raw.message === 'string' ? raw.message.trim() : ''
    if (!questionId || !questionText || !message) throw new Error('Invalid Agent clarification response')
    const plan = normalizeTaskPlan(raw.plan)
    const usage = normalizePlanUsage(raw.usage)
    const cost = normalizeRunCost(raw.cost)
    return {
      kind: 'waiting_user',
      turnId: responseTurnId,
      taskId: responseTaskId,
      message,
      question: { id: questionId, text: questionText },
      ...(plan ? { plan } : {}),
      ...(usage ? { usage } : {}),
      ...(cost ? { cost } : {}),
    }
  }

  const run = raw.run && typeof raw.run === 'object' ? (raw.run as Record<string, unknown>) : null
  if (!run) throw new Error('Invalid Agent run response')
  const plan = normalizeTaskPlan(raw.plan)
  return {
    kind: 'run',
    turnId: responseTurnId,
    taskId: responseTaskId,
    ...(plan ? { plan } : {}),
    run: normalizeRun(run),
  }
}

export async function recoverAgentRun(projectId: string, taskId: string): Promise<AgentRun> {
  const response = await apiRequest<{ run: Record<string, unknown> }>(
    `/api/projects/${encodeURIComponent(projectId)}/agent/runs/tasks/${encodeURIComponent(taskId)}`,
  )
  return normalizeRun(response.run)
}

async function recoverUnknownAgentRunStart(projectId: string, taskId: string): Promise<AgentRun> {
  let recoveryError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await recoverAgentRun(projectId, taskId)
    } catch (reason) {
      recoveryError = reason
      if (!(reason instanceof ApiError) || reason.status !== 404 || attempt === 2) break
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
  throw recoveryError
}

export async function startAgentRun(input: AgentPlanInput): Promise<AgentRun> {
  try {
    const response = await withWorkspaceSyncRaceRetry(() =>
      apiRequest<{ run: Record<string, unknown> }>(`/api/projects/${encodeURIComponent(input.projectId)}/agent/runs`, {
        method: 'POST',
        body: jsonBody(agentRunStartPayload(input)),
      }),
    )
    return normalizeRun(response.run)
  } catch (reason) {
    if (reason instanceof ApiError && reason.status < 500) throw reason
    try {
      return await recoverUnknownAgentRunStart(input.projectId, input.taskId)
    } catch {
      throw reason
    }
  }
}

export async function startAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await withWorkspaceSyncRaceRetry(() =>
        apiRequest<unknown>(`/api/projects/${encodeURIComponent(input.projectId)}/agent/runs`, {
          method: 'POST',
          body: jsonBody(agentRunStartPayload(input, input.turnId)),
        }),
      )
      return normalizeAgentTurnResult(response, input)
    } catch (reason) {
      lastError = reason
      const inProgress = reason instanceof ApiError && reason.code === 'AGENT_TURN_IN_PROGRESS'
      if (reason instanceof ApiError && reason.status < 500 && !inProgress) throw reason
      if (attempt === 2) break
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
  throw lastError
}

export type AgentTaskResponseInput = {
  projectId: string
  conversationId: string
  taskId: string
  questionId: string
  turnId: string
  response: string
  attachmentIds?: string[]
  selectionContext?: AgentSelectionContext
}

/** Answers a durable clarification without creating a replacement task. */
export async function respondAgentTask(input: AgentTaskResponseInput): Promise<AgentTurnResult> {
  const selectionContext = compileAgentSelectionContext(input.selectionContext)
  const response = await withWorkspaceSyncRaceRetry(() =>
    apiRequest<unknown>(
      `/api/projects/${encodeURIComponent(input.projectId)}/agent/tasks/${encodeURIComponent(input.taskId)}/respond`,
      {
        method: 'POST',
        body: jsonBody({
          conversationId: input.conversationId,
          questionId: input.questionId,
          turnId: input.turnId,
          response: input.response.trim().slice(0, 4_000),
          attachmentIds: input.attachmentIds ?? [],
          ...(selectionContext ? { selectionContext } : {}),
        }),
      },
    ),
  )
  return normalizeAgentTurnResult(response, {
    projectId: input.projectId,
    conversationId: input.conversationId,
    taskId: input.taskId,
    turnId: input.turnId,
    prompt: input.response,
    selectionContext,
  })
}

export async function getAgentRun(projectId: string, operationId: string): Promise<AgentRun> {
  const response = await apiRequest<{ run: Record<string, unknown> }>(
    `/api/projects/${encodeURIComponent(projectId)}/agent/runs/${encodeURIComponent(operationId)}`,
  )
  return normalizeRun(response.run)
}

export async function controlAgentRun(
  projectId: string,
  operationId: string,
  action: 'pause' | 'resume' | 'cancel',
): Promise<AgentRun> {
  const response = await apiRequest<{ run: Record<string, unknown> }>(
    `/api/projects/${encodeURIComponent(projectId)}/agent/runs/${encodeURIComponent(operationId)}/${action}`,
    { method: 'POST' },
  )
  return normalizeRun(response.run)
}

export async function finalizeAgentStartAttachments(projectId: string, operationId: string): Promise<AgentRun> {
  const response = await apiRequest<{ run: Record<string, unknown> }>(
    `/api/projects/${encodeURIComponent(projectId)}/agent/runs/${encodeURIComponent(operationId)}/attachments-ready`,
    { method: 'POST' },
  )
  return normalizeRun(response.run)
}

export async function undoAgentRun(
  projectId: string,
  operationId: string,
): Promise<{ rolledBackAt: string; receipt: unknown }> {
  return apiRequest(
    `/api/projects/${encodeURIComponent(projectId)}/agent/runs/${encodeURIComponent(operationId)}/undo`,
    {
      method: 'POST',
    },
  )
}

export async function pollAgentRun(
  projectId: string,
  initial: AgentRun,
  options: { intervalMs?: number; maxAttempts?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<AgentRun> {
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  let current = initial
  // Complex dashboard generation can spend well over a minute in the model
  // before the isolated renderer starts. Keep the product UI attached long
  // enough to observe the same durable run through its final commit.
  for (let attempt = 0; attempt < (options.maxAttempts ?? 300); attempt += 1) {
    if (
      current.status === 'committed' ||
      current.status === 'paused' ||
      current.status === 'stale' ||
      current.status === 'failed' ||
      current.status === 'canceled' ||
      current.status === 'indeterminate'
    ) {
      return current
    }
    await wait(options.intervalMs ?? 1_000)
    let next: AgentRun
    try {
      next = await getAgentRun(projectId, current.operationId)
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) {
        if (current.taskId) {
          next = await recoverAgentRun(projectId, current.taskId)
        } else {
          continue
        }
      } else {
        throw reason
      }
    }
    current = {
      ...next,
      ...((next.message ?? current.message) ? { message: next.message ?? current.message } : {}),
      ...((next.usage ?? current.usage) ? { usage: next.usage ?? current.usage } : {}),
      ...((next.cost ?? current.cost) ? { cost: next.cost ?? current.cost } : {}),
      ...((next.trace ?? current.trace) ? { trace: next.trace ?? current.trace } : {}),
      ...((next.pendingQuestion ?? current.pendingQuestion)
        ? { pendingQuestion: next.pendingQuestion ?? current.pendingQuestion }
        : {}),
    }
  }
  return current
}

export type StartAgentProjectInput = {
  idempotencyKey: string
  project: { name: string; description: string; schema: unknown }
  prompt: string
  attachments?: Array<Pick<AgentAttachmentInput, 'name' | 'scope' | 'mimeType' | 'type' | 'size'>>
}

export async function startAgentProject(input: StartAgentProjectInput): Promise<{
  project: { id: string; name: string }
  conversation: AgentConversation
  workspace: AgentWorkspaceRemoteRecord
  run: { operationId: string; taskId: string; status: 'planning' | 'paused' }
}> {
  return apiRequest('/api/agent/starts', { method: 'POST', body: jsonBody(input) })
}
