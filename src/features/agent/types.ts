export type AgentStorage = Pick<Storage, 'getItem' | 'setItem'>

export type AgentAttachmentScope = 'conversation' | 'project'

export type AgentAttachmentInput = {
  id?: string
  name: string
  scope: AgentAttachmentScope
  mimeType?: string
  type?: string
  size?: number
  url?: string
}

export type AgentAttachment = AgentAttachmentInput & {
  id: string
  projectId: string
  conversationId: string
  createdAt: string
}

export type AgentSelectionRef = {
  id: string
  title: string
  componentName: string
}

export type AgentSelectionContext = {
  pageId?: string
  pageLabel?: string
  selectedRefs: AgentSelectionRef[]
  viewport?: {
    width?: number
    height?: number
  }
}

export type AgentMessageRole = 'user' | 'assistant' | 'system'

export type AgentMessage = {
  id: string
  taskId?: string
  localOnlyExecutionProjection?: true
  role: AgentMessageRole
  content: string
  attachments: AgentAttachment[]
  createdAt: string
}

export type AgentTaskStatus = 'waiting' | 'waiting_user' | 'paused' | 'running' | 'complete' | 'failed' | 'canceled'
export type AgentTaskStageStatus = 'pending' | 'waiting' | 'running' | 'complete' | 'failed'
export type AgentTaskStageId = 'understand-requirements' | 'plan-layout' | 'bind-data' | 'preview-check'

export type AgentTaskStage = {
  id: AgentTaskStageId
  title: string
  status: AgentTaskStageStatus
  detail?: string
}

export type AgentTaskPlanStepStatus = 'pending' | 'running' | 'complete' | 'failed' | 'canceled'

export type AgentTaskPlanStep = {
  id: string
  title: string
  status: AgentTaskPlanStepStatus
  detail?: string
}

export type AgentTaskPlan = {
  summary: string
  steps: AgentTaskPlanStep[]
}

export type AgentSemanticTaskRunStatus =
  | 'planning'
  | 'waiting_user'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'blocked_material'
  | 'paused'
  | 'failed'
  | 'canceled'
  | 'rolling_back'
  | 'rolled_back'
  | 'rollback_blocked'

export type AgentSemanticTaskStepStatus =
  | 'pending'
  | 'running'
  | 'verifying'
  | 'passed'
  | 'revising'
  | 'failed'
  | 'superseded'

export type AgentSemanticTaskStep = {
  id: string
  planVersion: number
  ordinal: number
  semanticStepKey: string
  title: string
  intent: Record<string, unknown>
  status: AgentSemanticTaskStepStatus
  lastObservation: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export type AgentTaskActivePlan = {
  id: string
  version: number
  summary: string
  assumptions: unknown
  verification: unknown
  createdAt: string
  steps: AgentSemanticTaskStep[]
}

export type AgentTaskPublicEventType =
  | 'plan_created'
  | 'plan_revised'
  | 'step_started'
  | 'material_selected'
  | 'change_prepared'
  | 'change_committed'
  | 'preview_checked'
  | 'step_revising'
  | 'fallback_selected'
  | 'material_gap'
  | 'waiting_user'
  | 'step_passed'
  | 'step_superseded'
  | 'rollback_started'
  | 'rollback_completed'
  | 'rollback_blocked'
  | 'task_failed'
  | 'task_completed'

export type AgentTaskTechnicalDetails = {
  errorCode?: string
  operationId?: string
  receiptId?: string
  cost?: {
    amountMicros: number
    accuracy?: 'actual' | 'estimated' | 'billing_indeterminate'
  }
}

export type AgentTaskPublicEvent = {
  taskRunId: string
  seq: number
  eventKey: string
  stepId: string | null
  type: AgentTaskPublicEventType
  summary: string
  publicPayload: Record<string, unknown>
  technicalDetails?: AgentTaskTechnicalDetails
  redactionVersion: number
  createdAt: string
}

export type AgentTaskRunModelBinding = {
  provider: string
  model: string
  profileId: string
  configDigest: string
}

export type AgentTaskRunBounds = {
  maxProviderTurns: number
  maxStepRevisions: number
  maxExecutorRetries: number
  tokenLimit: number
  costLimitMicros: number
}

export type AgentTaskRunAccounting = {
  providerTurns: number
  executorRetries: number
  semanticRevisions: number
  promptTokens: number
  completionTokens: number
  costMicros: number
}

export type AgentTaskRunDetail = {
  id: string
  projectId: string
  conversationId: string
  taskId: string
  status: AgentSemanticTaskRunStatus
  activePlanVersion: number
  currentTransitionKey: string | null
  modelBinding: AgentTaskRunModelBinding
  bounds: AgentTaskRunBounds
  accounting: AgentTaskRunAccounting
  taskStartDocumentRevision: number
  latestEventSequence: number
  activePlan: AgentTaskActivePlan | null
  waiting: { questionId: string; text: string } | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type AgentPendingQuestion = {
  id: string
  messageId: string
  prompt: string
  askedAt: string
}

export type AgentRunCostAccuracy = 'actual' | 'estimated' | 'billing_indeterminate'

export type AgentRunCost = {
  amount?: number
  currency?: string
  accuracy?: AgentRunCostAccuracy
  minimumAmount?: number
  maximumAmount?: number
}

export type AgentRunTrace = {
  promptBundleId: string
  promptBundleVersion: string
  promptBundleHash: string
  skills: string[]
}

export type AgentTask = {
  id: string
  title: string
  status: AgentTaskStatus
  stages: AgentTaskStage[]
  taskRunId?: string
  activePlan?: AgentTaskActivePlan
  activities?: AgentTaskPublicEvent[]
  latestEventSequence?: number
  taskRun?: Omit<AgentTaskRunDetail, 'activePlan' | 'waiting'>
  legacyCompatibility?: true
  legacyCompatibilitySnapshot?: AgentWorkspaceLegacyTaskV2
  plan?: AgentTaskPlan
  pendingQuestion?: AgentPendingQuestion
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  run?: {
    operationId: string
    status:
      | 'planning'
      | 'running'
      | 'paused'
      | 'prepared'
      | 'committed'
      | 'stale'
      | 'failed'
      | 'canceled'
      | 'indeterminate'
    outcome?: unknown
    receipt?: unknown
    cost?: AgentRunCost
    trace?: AgentRunTrace
    rollback?: unknown
    rolledBackAt?: string
    rollbackReceipt?: unknown
  }
  createdAt: string
  updatedAt: string
}

export type AgentConversation = {
  id: string
  ownerUserId: string
  projectId: string
  projectName?: string
  visibility: 'private'
  title: string
  messages: AgentMessage[]
  tasks: AgentTask[]
  createdAt: string
  updatedAt: string
}

export type ProjectContextStatus = 'pending' | 'confirmed'

export type AgentProjectContextSourceKind = 'user_request' | 'agent_plan' | 'agent_result'

export type AgentProjectContextProvenance = {
  origin: 'agent_task' | 'manual'
  sourceKinds: AgentProjectContextSourceKind[]
}

export type AgentProjectContextRevision = {
  revision: number
  title: string
  content: string
  status: ProjectContextStatus
  sourceTaskId?: string
  provenance?: AgentProjectContextProvenance
  createdAt: string
}

export type AgentProjectContext = {
  id: string
  projectId: string
  title: string
  content: string
  status: ProjectContextStatus
  revision: number
  history: AgentProjectContextRevision[]
  sourceTaskId?: string
  provenance?: AgentProjectContextProvenance
  createdAt: string
  updatedAt: string
  confirmedAt?: string
}

export type AgentProjectContextTombstone = {
  id: string
  projectId: string
  deletedAt: string
}

export type AgentPreferences = {
  defaultAttachmentScope: AgentAttachmentScope
  rememberProjectContext: boolean
  showTaskProgress: boolean
}

export type AgentWorkspace = {
  version: 1 | 2
  ownerUserId: string
  preferences: AgentPreferences
  conversations: AgentConversation[]
  projectContexts: AgentProjectContext[]
  projectContextTombstones: AgentProjectContextTombstone[]
}

export type AgentProjectWorkspacePayloadV1 = {
  version: 1
  ownerUserId: string
  projectId: string
  conversations: AgentConversation[]
  projectContexts: AgentProjectContext[]
  projectContextTombstones?: AgentProjectContextTombstone[]
}

export type AgentWorkspaceTaskV2 = Pick<AgentTask, 'id' | 'title' | 'createdAt' | 'updatedAt'> & {
  taskRunId?: string
}

export type AgentWorkspaceLegacyTaskV2 = Pick<
  AgentTask,
  'id' | 'title' | 'status' | 'stages' | 'plan' | 'pendingQuestion' | 'usage' | 'run' | 'createdAt' | 'updatedAt'
>

export type AgentWorkspaceConversationV2 = Omit<AgentConversation, 'tasks'> & {
  tasks: Array<AgentWorkspaceTaskV2 | AgentWorkspaceLegacyTaskV2>
}

export type AgentProjectWorkspacePayloadV2 = {
  version: 2
  ownerUserId: string
  projectId: string
  conversations: AgentWorkspaceConversationV2[]
  projectContexts: AgentProjectContext[]
  projectContextTombstones?: AgentProjectContextTombstone[]
}

export type AgentProjectWorkspacePayload = AgentProjectWorkspacePayloadV1 | AgentProjectWorkspacePayloadV2

export type AgentWorkspaceRemoteRecord = {
  ownerId: string
  projectId: string
  revision: number
  payload: AgentProjectWorkspacePayload
  createdAt: string
  updatedAt: string
}

export type AgentWorkspaceListener = (workspace: AgentWorkspace) => void

export type CreateAgentConversationInput = {
  ownerUserId: string
  projectId: string
  projectName?: string
  title?: string
  initialMessage?: string
  prompt?: string
  attachments?: AgentAttachmentInput[]
  createdAt?: string
}

export type AppendAgentTurnInput = {
  ownerUserId: string
  conversationId: string
  role?: AgentMessageRole
  taskId?: string
  content: string
  attachments?: AgentAttachmentInput[]
  createdAt?: string
}

export type SetAgentMessageAttachmentsInput = {
  ownerUserId: string
  conversationId: string
  messageId: string
  attachments: AgentAttachmentInput[]
  updatedAt?: string
}

export type UpdateTaskProgressInput = {
  ownerUserId: string
  conversationId: string
  taskId?: string
  taskStatus?: AgentTaskStatus
  stageId?: AgentTaskStageId
  stageStatus?: AgentTaskStageStatus
  detail?: string
  usage?: AgentTask['usage']
  updatedAt?: string
}

export type RecordAgentRunInput = {
  ownerUserId: string
  conversationId: string
  taskId: string
  operationId: string
  status: NonNullable<AgentTask['run']>['status']
  outcome?: unknown
  receipt?: unknown
  cost?: NonNullable<AgentTask['run']>['cost']
  trace?: NonNullable<AgentTask['run']>['trace']
  rollback?: unknown
  rolledBackAt?: string
  rollbackReceipt?: unknown
  message?: string
  usage?: AgentTask['usage']
  localOnlyExecutionProjection?: boolean
  updatedAt?: string
}

export type RecordAgentRunRollbackInput = {
  ownerUserId: string
  conversationId: string
  operationId: string
  receipt?: unknown
  updatedAt?: string
}

export type RecordAgentPlanResultInput = {
  ownerUserId: string
  conversationId: string
  taskId: string
  message: string
  usage?: AgentTask['usage']
  updatedAt?: string
}

export type RecordAgentTaskQuestionInput = {
  ownerUserId: string
  conversationId: string
  taskId: string
  questionId: string
  message: string
  prompt?: string
  plan?: AgentTaskPlan
  usage?: AgentTask['usage']
  localOnlyExecutionProjection?: boolean
  updatedAt?: string
}

export type RecordAgentTaskPlanInput = {
  ownerUserId: string
  conversationId: string
  taskId: string
  plan: AgentTaskPlan
  taskStatus?: AgentTaskStatus
  usage?: AgentTask['usage']
  updatedAt?: string
}

export type RecordAgentTaskRunDetailInput = {
  ownerUserId: string
  conversationId: string
  detail: AgentTaskRunDetail
  events?: AgentTaskPublicEvent[]
}

export type UpsertProjectContextInput = {
  ownerUserId: string
  projectId: string
  contextId?: string
  title: string
  content: string
  status?: ProjectContextStatus
  sourceTaskId?: string
  provenance?: AgentProjectContextProvenance
  updatedAt?: string
}

export type AgentStore = {
  readWorkspace(ownerUserId: string): AgentWorkspace
  createConversation(input: CreateAgentConversationInput): AgentConversation
  appendTurn(input: AppendAgentTurnInput): AgentConversation
  setMessageAttachments(input: SetAgentMessageAttachmentsInput): AgentConversation
  getProjectConversations(ownerUserId: string, projectId: string): AgentConversation[]
  getConversation(ownerUserId: string, conversationId: string): AgentConversation | undefined
  updateTaskProgress(input: UpdateTaskProgressInput): AgentTask
  recordPlanResult(input: RecordAgentPlanResultInput): AgentConversation
  recordTaskQuestion(input: RecordAgentTaskQuestionInput): AgentConversation
  recordTaskPlan(input: RecordAgentTaskPlanInput): AgentTask
  recordRun(input: RecordAgentRunInput): AgentTask
  recordRunRollback(input: RecordAgentRunRollbackInput): AgentTask
  upsertProjectContext(input: UpsertProjectContextInput): AgentProjectContext
  deleteProjectContext(ownerUserId: string, projectId: string, contextId: string): boolean
  confirmProjectContext(ownerUserId: string, projectId: string, contextId: string): AgentProjectContext
  rollbackProjectContext(
    ownerUserId: string,
    projectId: string,
    contextId: string,
    revision?: number,
  ): AgentProjectContext
  readPreferences(ownerUserId: string): AgentPreferences
  updatePreferences(ownerUserId: string, update: Partial<AgentPreferences>): AgentPreferences
  subscribe(ownerUserId: string, listener: AgentWorkspaceListener): () => void
}
