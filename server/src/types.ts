import type { AgentSkillTrace } from './agent/agent-skill-trace.js'
import type { AgentUserPreferenceMemory } from './agent/agent-user-preferences.js'
import type { ProjectSchema } from './validation.js'

export interface PublicUser {
  id: string
  email: string | null
}

export type OAuthProvider = 'github' | 'google'

export interface AuthSession {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  user: PublicUser
}

export interface AuthService {
  signUp(email: string, password: string): Promise<{ user: PublicUser; session: AuthSession | null }>
  signIn(email: string, password: string): Promise<AuthSession>
  startOAuth(provider: OAuthProvider, redirectTo: string): Promise<{ url: string; codeVerifier: string }>
  exchangeCode(code: string, codeVerifier: string): Promise<AuthSession>
  requestPasswordReset(email: string, redirectTo: string): Promise<{ codeVerifier: string }>
  updatePassword(accessToken: string, refreshToken: string, password: string): Promise<AuthSession>
  refresh(refreshToken: string): Promise<AuthSession>
  getUser(accessToken: string): Promise<PublicUser | null>
  signOut(accessToken: string | undefined, refreshToken: string | undefined): Promise<void>
}

export type PersonalSpaceProvisioner = (user: PublicUser) => Promise<void>

export interface ProjectSummaryRecord {
  id: string
  name: string
  description: string | null
  coverUrl: string | null
  draftVersion: number
  isFavorite: boolean
  pageCount: number
  canvasWidth: number
  canvasHeight: number
  startPageId: string | null
  draftSavedAt: Date
  thumbnailMode: 'auto' | 'custom'
  thumbnailStatus: 'queued' | 'rendering' | 'ready' | 'failed'
  thumbnailPath: string | null
  thumbnailUrl: string | null
  thumbnailDraftVersion: number | null
  thumbnailErrorCode: string | null
  publicationSlug?: string | null
  publishedRevisionId?: string | null
  publishedAt: Date | null
  currentReleaseNumber: number | null
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ProjectRecord extends ProjectSummaryRecord {
  draftSchema: ProjectSchema
}

export type ProjectRole = 'owner' | 'editor' | 'viewer'

export interface ProjectMemberRecord {
  projectId: string
  userId: string
  role: ProjectRole
  createdAt: Date
  createdBy: string
}

export type RevisionKind = 'auto' | 'manual' | 'pre_restore' | 'publish' | 'agent'
export type ThumbnailMode = 'auto' | 'custom'
export type ThumbnailSource = 'renderer' | 'blueprint' | 'custom'

export interface ThumbnailUploadContract {
  bucket: string
  path: string
  signedUrl: string
  token: string
  draftVersion: number
  mode: ThumbnailMode
  contentType: 'image/webp' | 'image/svg+xml'
  maxBytes: number
  expiresIn: number
}

export interface ThumbnailReconcileResult {
  deleted: number
  retryPending: number
}

export type AgentAssetStatus = 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted'
export interface AgentAssetRecord {
  id: string
  projectId: string
  conversationId: string | null
  originalName: string
  contentType: string
  size: number
  sha256: string | null
  status: AgentAssetStatus
  extractedText: string | null
  storagePath: string
  createdAt: Date
  updatedAt: Date
}
export interface PendingAgentAssetUploadContract {
  id: string
  bucket: string
  path: string
  signedUrl: string
  token: string
  maxBytes: number
  expiresIn: number
  alreadyCompleted?: false
}
export interface CompletedAgentAssetUploadContract {
  id: string
  path: string
  alreadyCompleted: true
  asset: Pick<AgentAssetRecord, 'id' | 'originalName' | 'contentType' | 'size'>
}
export type AgentAssetUploadContract = PendingAgentAssetUploadContract | CompletedAgentAssetUploadContract
export interface AgentScreenshotArtifactRecord {
  id: string
  actorId: string
  projectId: string
  operationId: string
  candidateSha256: string
  draftVersion: number
  contentType: 'image/png'
  size: number
  sha256: string
  status: 'uploading' | 'ready' | 'failed'
  storagePath: string
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
export interface PendingAgentScreenshotArtifactUploadContract {
  artifact: AgentScreenshotArtifactRecord
  bucket: string
  path: string
  signedUrl: string
  token: string
  maxBytes: number
  expiresIn: number
  alreadyCompleted: false
}
export interface CompletedAgentScreenshotArtifactUploadContract {
  artifact: AgentScreenshotArtifactRecord
  alreadyCompleted: true
}
export type AgentScreenshotArtifactUploadContract =
  | PendingAgentScreenshotArtifactUploadContract
  | CompletedAgentScreenshotArtifactUploadContract
export interface AgentScreenshotArtifactDownloadContract {
  artifact: AgentScreenshotArtifactRecord
  signedUrl: string
  expiresIn: number
}
export interface AgentRunCostRecord {
  id: string
  actorId: string
  projectId: string
  taskId: string
  turnId: string
  inputDigest: string
  state: 'reserved' | 'settled' | 'released'
  accuracy?: 'actual' | 'estimated' | 'billing_indeterminate' | null
  reservedMicros: number
  settledMicros: number
  minimumMicros: number | null
  maximumMicros: number | null
  operationId: string | null
  provider: string | null
  model: string | null
  profile: string | null
  promptTokens: number | null
  completionTokens: number | null
  traceId: string | null
  decisionOutput: Record<string, unknown> | null
  decisionUsage: Record<string, unknown> | null
  decisionTrace: Record<string, unknown> | null
  billingScope: 'project' | 'user'
  payerId: string
  reservationExpiresAt: Date
  createdAt: Date
  updatedAt: Date
}
export type AgentRunDispatchState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'indeterminate'
export type AgentRunDispatchDesiredState = 'running' | 'paused' | 'canceled'
export type AgentRunDispatchControlAction = 'pause' | 'resume' | 'cancel'
export interface AgentRunDispatchRecord {
  id: string
  actorId: string
  projectId: string
  conversationId: string
  taskId: string
  operationId: string
  kind: 'initial' | 'run'
  waitingReason: 'upload' | 'user' | null
  turnId?: string | null
  inputDigest?: string | null
  inputSnapshot?: Record<string, unknown> | null
  phase?: 'waiting_input' | 'planning' | 'executing' | 'terminal' | null
  frozenProvider?: string | null
  frozenModel?: string | null
  frozenProfile?: string | null
  frozenConfigDigest?: string | null
  billingScope?: 'project' | 'user' | null
  payerId?: string | null
  taskLimitMicros?: number | null
  projectLimitMicros?: number | null
  warningRatio?: number | null
  providerIdempotency?: 'unsupported' | 'stable' | null
  state: AgentRunDispatchState
  desiredState: AgentRunDispatchDesiredState
  generation: number
  leaseOwner: string | null
  leaseUntil: Date | null
  heartbeatAt: Date | null
  attemptCount: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}
export interface AgentMutationAuthority {
  dispatchAttempt?: {
    dispatchId: string
    workerId: string
    leaseGeneration: number
  }
}
export interface AgentBudgetUsageRecord {
  taskMicros: number
  projectMonthMicros: number
}
export type AgentAssetScope = 'conversation' | 'project'

export interface AgentProviderInputSnapshot {
  systemPrompt: string
  userText: string
  trace: {
    promptBundleId: string
    promptBundleVersion: string
    promptBundleHash: string
    skills: string[]
  }
  images: Array<{ assetId: string; sha256: string }>
}

export interface DurableAgentTurnRecord {
  actorId: string
  projectId: string
  conversationId: string
  taskId: string
  turnId: string
  operationId: string
  inputDigest: string
  prompt: string
  attachmentIds: string[]
  projectContext: Array<{ title: string; content: string; status: 'pending' | 'confirmed' }>
  provider: string
  model: string
  profileId: string
  endpoint: string
  billingScope: 'project' | 'user'
  payerId: string
  taskLimitMicros: number
  projectMonthLimitMicros: number
  projectDraftVersion: number
  reservedMicros: number
  maximumRateMicrosPerToken: number
  providerInputSnapshot: AgentProviderInputSnapshot
  idempotencyMode: 'unsupported' | 'stable'
  providerRequestKey: string | null
}

export interface AgentProviderAttemptRecord {
  id: string
  actorId: string
  projectId: string
  dispatchId: string | null
  dispatchGeneration: number | null
  dispatchWorkerId: string | null
  taskTransitionId: string | null
  transitionLeaseGeneration: number | null
  transitionLeaseToken: string | null
  transitionWorkerId: string | null
  attemptNo: number
  providerRequestKey: string | null
  requestBodyDigest: string
  state: 'prepared' | 'started' | 'succeeded' | 'failed_definite' | 'outcome_unknown'
  reservationDeltaMicros: number
  costAccuracy: 'actual' | 'estimated' | 'billing_indeterminate' | null
  amountMicros: number | null
  minimumMicros: number | null
  maximumMicros: number | null
  promptTokens: number | null
  completionTokens: number | null
  cachedTokens: number | null
  durationMs: number | null
  upstreamRequestId: string | null
  errorCode: string | null
  errorMessage: string | null
  preparedAt: Date
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type DurableProviderAttemptRecord = Pick<
  AgentProviderAttemptRecord,
  'id' | 'state' | 'providerRequestKey' | 'requestBodyDigest'
> & { idempotencyMode: 'unsupported' | 'stable' }

export interface DispatchProviderAttemptFence {
  kind?: 'dispatch'
  dispatchId: string
  workerId: string
  leaseGeneration: number
}

export interface TransitionProviderAttemptFence {
  kind: 'transition'
  transitionId: string
  workerId: string
  leaseGeneration: number
  leaseToken: string
}

export type AgentProviderAttemptFence = DispatchProviderAttemptFence | TransitionProviderAttemptFence

export type AgentTaskRunStatus =
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
export type AgentTaskStepStatus = 'pending' | 'running' | 'verifying' | 'passed' | 'revising' | 'failed' | 'superseded'
export type AgentTaskTransitionKind = 'planning' | 'step_action' | 'observation' | 'final_verification' | 'rollback'
export type AgentTaskTransitionStatus = 'pending' | 'leased' | 'completed' | 'failed' | 'canceled'
export type AgentTaskEventType =
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

export interface AgentConversationModelBindingRecord {
  id: string
  actorId: string
  projectId: string
  conversationId: string
  provider: string
  model: string
  profileId: string
  configDigest: string
  boundAt: Date
  createdAt: Date
}
export interface AgentTaskRunBounds {
  /** Legacy telemetry only. Provider turns are no longer a task execution bound. */
  maxProviderTurns?: number
  /** Legacy telemetry only. Semantic revisions continue until completion or cost exhaustion. */
  maxStepRevisions?: number
  maxExecutorRetries: number
  tokenLimit: number
  costLimitMicros: number
}
export interface AgentTaskRunRecord {
  id: string
  actorId: string
  projectId: string
  conversationId: string
  taskId: string
  idempotencyKey: string
  requestDigest: string
  status: AgentTaskRunStatus
  activePlanVersion: number
  currentTransitionKey: string | null
  modelBindingId: string
  provider: string
  model: string
  profileId: string
  configDigest: string
  bounds: AgentTaskRunBounds
  providerTurns: number
  executorRetries: number
  semanticRevisions: number
  promptTokens: number
  completionTokens: number
  costMicros: number
  taskStartDocumentRevision: number
  nextTransitionGeneration: number
  nextEventSequence: number
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}
export interface AgentTaskPlanRecord {
  id: string
  taskRunId: string
  version: number
  summary: string
  assumptions: unknown
  verification: unknown
  createdAt: Date
}
export interface AgentTaskStepRecord {
  id: string
  taskRunId: string
  planVersion: number
  ordinal: number
  semanticStepKey: string
  title: string
  intent: Record<string, unknown>
  status: AgentTaskStepStatus
  lastObservation: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}
export interface AgentTaskStepAttemptRecord {
  id: string
  taskRunId: string
  stepId: string
  attemptNumber: number
  decisionKind: string
  transitionKey: string
  providerCallReference: string | null
  operationId: string | null
  executorRetryCount: number
  semanticRevisionCount: number
  observation: Record<string, unknown> | null
  terminalClassification: string | null
  createdAt: Date
  completedAt: Date | null
}
export interface AgentTaskTransitionRecord {
  id: string
  actorId: string
  projectId: string
  taskRunId: string
  stepId: string | null
  kind: AgentTaskTransitionKind
  transitionKey: string
  generation: number
  status: AgentTaskTransitionStatus
  availableAt: Date
  leaseOwner: string | null
  leaseGeneration: number
  leaseToken: string | null
  leaseUntil: Date | null
  projectLeaseGeneration: number | null
  projectLeaseToken: string | null
  projectLeaseWorkerId: string | null
  heartbeatAt: Date | null
  claimAttempts: number
  operationId: string | null
  stepAttemptId: string | null
  input: Record<string, unknown>
  requestDigest: string
  completionDigest: string | null
  output: Record<string, unknown> | null
  error: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}
export type AgentTaskReconciliationClassification =
  | 'already_pending'
  | 'lease_live'
  | 'requeued'
  | 'provider_outcome_unknown_paused'
export interface AgentTaskReconciliationResult {
  transition: AgentTaskTransitionRecord
  classification: AgentTaskReconciliationClassification
}
export type AgentProviderTaskOutcomeClassification =
  | 'within_budget'
  | 'task_budget_exceeded_paused'
  | 'provider_outcome_unknown_paused'
  | 'transition_failed_terminal'
export interface AgentProviderAttemptSettlementResult {
  attempt: DurableProviderAttemptRecord
  cost: AgentRunCostRecord | null
  taskOutcomeClassification: AgentProviderTaskOutcomeClassification
}
export type AgentProviderAttemptReconciliationClassification =
  | 'lease_live'
  | 'prepared_failed_definite'
  | 'started_outcome_unknown'
export interface AgentProviderAttemptReconciliationResult {
  attempt: DurableProviderAttemptRecord
  classification: AgentProviderAttemptReconciliationClassification
}
export interface AgentTaskTransitionProviderResult {
  attemptId: string
  decisionOutput: Record<string, unknown>
  decisionUsage: Record<string, unknown> | null
  decisionTrace: Record<string, unknown>
}
export interface AgentTaskTransitionFence {
  transitionId: string
  workerId: string
  leaseGeneration: number
  leaseToken: string
  projectLeaseGeneration?: number | null
  projectLeaseToken?: string | null
  projectLeaseWorkerId?: string | null
}
export interface AgentTaskEventRecord {
  taskRunId: string
  seq: number
  eventKey: string
  stepId: string | null
  type: AgentTaskEventType
  summary: string
  publicPayload: Record<string, unknown>
  technicalPayload: Record<string, unknown>
  redactionVersion: number
  createdAt: Date
}
export interface AgentTaskEventTechnicalDetails {
  errorCode?: string
  operationId?: string
  receiptId?: string
  cost?: {
    amountMicros: number
    accuracy?: 'actual' | 'estimated' | 'billing_indeterminate'
  }
}
export interface AgentTaskPublicEventRecord {
  taskRunId: string
  seq: number
  eventKey: string
  stepId: string | null
  type: AgentTaskEventType
  summary: string
  publicPayload: Record<string, unknown>
  technicalDetails?: AgentTaskEventTechnicalDetails
  redactionVersion: number
  createdAt: Date
}
export interface AgentTaskRunDetailRecord {
  run: AgentTaskRunRecord
  activePlan: { plan: AgentTaskPlanRecord; steps: AgentTaskStepRecord[] } | null
  waitingReason: { summary: string; publicPayload: Record<string, unknown> } | null
  latestEventSequence: number
}
export interface AgentTaskEventPageRecord {
  events: AgentTaskEventRecord[]
  latestEventSequence: number
}
export interface AgentTaskEventRetentionPolicy {
  version: 'unbounded_v1'
  /** Zero when the run has no events; otherwise sequence one remains readable. */
  earliestAvailableSequence: number
}
export interface AgentTaskArtifactPolicy {
  /** V1 does not create task artifacts and therefore has no artifact expiry lifecycle. */
  version: 'none_v1'
}
export interface AgentProjectTaskLeaseRecord {
  projectId: string
  taskRunId: string
  leaseGeneration: number
  leaseToken: string
  leaseOwner: string
  leaseUntil: Date
  heartbeatAt: Date
  createdAt: Date
  updatedAt: Date
}
export interface AgentTaskOperationalEventRecord {
  id: string
  dedupeKey: string
  actorId: string | null
  projectId: string | null
  taskRunId: string | null
  transitionId: string | null
  operationId: string | null
  code: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  details: Record<string, unknown>
  createdAt: Date
}

export interface AgentTaskFinalVerificationEvidence {
  operationId: string
  receiptId: string
  committedDraftVersion: number
  verifiedAt: string
  documentValid: true
  renderReady: true
  browserErrors: []
  resourceErrors: []
  layoutPassed?: true
  freshContextVerified: true
  receiptConsistent: true
  visualAccepted: true
  visualReviewConfidence: number
}

export interface AgentTaskCompletionInput {
  status: 'completed' | 'failed' | 'canceled'
  output?: Record<string, unknown>
  error?: Record<string, unknown>
  taskRunPatch?: {
    status?: AgentTaskRunStatus
    currentTransitionKey?: string | null
  }
  accountingDelta?: {
    executorRetries?: number
    semanticRevisions?: number
  }
  stepPatch?: { stepId: string; status: AgentTaskStepStatus; lastObservation?: Record<string, unknown> | null }
  plan?: {
    summary: string
    assumptions: unknown
    verification: unknown
    steps: Array<{ id?: string; ordinal?: number; title: string; intent: Record<string, unknown> }>
  }
  stepAttempt?: {
    stepId: string
    decisionKind: string
    providerCallReference?: string | null
    operationId?: string | null
    executorRetryCount?: number
    semanticRevisionCount?: number
    observation?: Record<string, unknown> | null
    terminalClassification?: string | null
  }
  finalVerification?: AgentTaskFinalVerificationEvidence
  events?: Array<{
    eventKey: string
    stepId?: string | null
    type: AgentTaskEventType
    summary: string
    publicPayload?: Record<string, unknown>
    technicalPayload?: Record<string, unknown>
    redactionVersion?: number
  }>
  nextTransition?: {
    stepId?: string | null
    stepOrdinal?: number
    kind: AgentTaskTransitionKind
    transitionKey: string
    availableAt?: Date
    input?: Record<string, unknown>
  }
  now: Date
}

export interface RevisionRecord {
  id: string
  projectId: string
  revisionNumber: number
  kind: RevisionKind
  label: string | null
  sourceDraftVersion: number
  schema: ProjectSchema
  createdAt: Date
}

export interface PublicProject {
  slug: string
  projectId: string
  name: string
  description: string | null
  revisionId: string
  revisionNumber: number
  releaseNumber: number
  schema: ProjectSchema
  publishedAt: Date
}

export interface PublishProjectResult extends PublicProject {
  isCurrent: boolean
  isPublished: boolean
}

export interface ReleaseRecord {
  projectId: string
  releaseNumber: number
  revisionId: string
  revisionNumber: number
  name: string
  description: string | null
  publishedAt: Date
  slug: string | null
  isCurrent: boolean
  isPublished: boolean
}

export interface ProjectPublishSnapshotRecord {
  id: string
  projectId: string
  draftVersion: number
  document: ProjectSchema
  documentSha256: string
  createdBy: string
  createdAt: Date
}

export interface ProjectPreviewRunRecord {
  id: string
  projectId: string
  publishSnapshotId: string
  source: 'agent_executor' | 'owner_live_render_attestation' | 'editor_renderer_artifact' | 'editor_blueprint_artifact'
  status: 'verified'
  documentSha256: string
  rendererVersion: string
  rendererSha256: string
  evidence: Record<string, unknown>
  agentOperationId: string | null
  thumbnailArtifactId: string | null
  artifactPath: string | null
  artifactSize: number | null
  artifactDraftVersion: number | null
  createdBy: string
  createdAt: Date
}

export interface ProjectPublishApprovalRecord {
  id: string
  projectId: string
  publishSnapshotId: string
  previewRunId: string
  approvedBy: string
  approvedAt: Date
  consumedAt: Date | null
  consumedReleaseId: string | null
}

export type AgentSpikeOperationStatus =
  | 'issued'
  | 'prepared'
  | 'committed'
  | 'rejected_stale'
  | 'failed_not_applied'
  | 'indeterminate'

export interface EditableAgentSpikeProject {
  id: string
  draftVersion: number
  draftSchema: ProjectSchema
}

export interface AgentSpikeOperationRecord {
  id: string
  actorId: string
  projectId: string
  taskId: string
  stageId: string
  executorId: string
  operationId: string
  grantJti: string
  baseDraftVersion: number
  inputDigest: string
  executorInput: Record<string, unknown>
  issueDigest: string
  skillTrace: AgentSkillTrace | null
  compatibility: Record<string, string>
  expiresAt: Date
  status: AgentSpikeOperationStatus
  candidateDigest: string | null
  preparedDigest: string | null
  candidateSchema: ProjectSchema | null
  hostReceipt: Record<string, unknown> | null
  evidence: Record<string, unknown> | null
  preparedAt: Date | null
  committedDraftVersion: number | null
  rollbackRevisionId: string | null
  rolledBackAt: Date | null
  rollbackReceipt: Record<string, unknown> | null
  outcome: Record<string, unknown> | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentSpikeOperationBinding {
  projectId: string
  taskId: string
  stageId: string
  executorId: string
  operationId: string
}

export interface AgentRunUndoRecord {
  project: ProjectRecord
  rolledBackAt: Date
  receipt: Record<string, unknown>
}

export interface AgentWorkspaceRecord {
  ownerId: string
  projectId: string
  revision: number
  payload: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface AgentProjectStartRecord {
  project: ProjectRecord
  workspace: AgentWorkspaceRecord
  dispatch?: AgentRunDispatchRecord
}

export type AgentProjectContextSourceKind = 'user_request' | 'agent_plan' | 'agent_result'

export interface AgentProjectContextProvenance {
  origin: 'agent_task' | 'manual'
  sourceKinds: AgentProjectContextSourceKind[]
}

export interface AgentProjectContextRevision {
  revision: number
  title: string
  content: string
  status: 'confirmed'
  sourceTaskId?: string
  provenance?: AgentProjectContextProvenance
  createdAt: string
}

export interface AgentProjectContextRecord {
  id: string
  projectId: string
  title: string
  content: string
  status: 'confirmed'
  revision: number
  history: AgentProjectContextRevision[]
  sourceTaskId?: string
  provenance?: AgentProjectContextProvenance
  createdAt: Date
  updatedAt: Date
  confirmedAt: Date
}

export interface Repository {
  ping(): Promise<void>
  resolveAgentConversationModelBinding?(
    actorId: string,
    input: {
      projectId: string
      conversationId: string
      provider: string
      model: string
      profileId: string
      configDigest: string
      now: Date
    },
  ): Promise<AgentConversationModelBindingRecord | 'configuration_drift' | null>
  createAgentTaskRun?(
    actorId: string,
    input: {
      projectId: string
      conversationId: string
      taskId: string
      idempotencyKey: string
      binding: { provider: string; model: string; profileId: string; configDigest: string }
      bounds: AgentTaskRunBounds
      taskStartDocumentRevision: number
      planningInput?: Record<string, unknown>
      now: Date
    },
  ): Promise<AgentTaskRunRecord | 'configuration_drift' | 'conflict' | 'workspace_unavailable' | null>
  getAgentTaskRun?(actorId: string, taskRunId: string): Promise<AgentTaskRunRecord | null>
  getAgentTaskRunDetail?(
    actorId: string,
    projectId: string,
    taskRunId: string,
  ): Promise<AgentTaskRunDetailRecord | null>
  listAgentTaskEvents?(
    actorId: string,
    projectId: string,
    taskRunId: string,
    input: { afterSeq: number; limit: number },
  ): Promise<AgentTaskEventRecord[] | null>
  listAgentTaskEventPage?(
    actorId: string,
    projectId: string,
    taskRunId: string,
    input: { afterSeq: number; limit: number },
  ): Promise<AgentTaskEventPageRecord | null>
  continueAgentTaskRun?(
    actorId: string,
    input: {
      projectId: string
      taskRunId: string
      idempotencyKey: string
      questionId: string
      response: string
      attachmentIds: string[]
      imageInputs: Array<{ assetId: string; sha256: string }>
      now: Date
    },
  ): Promise<
    { taskRun: AgentTaskRunRecord; transition: AgentTaskTransitionRecord } | 'conflict' | 'invalid_state' | null
  >
  resumeAgentTaskRun?(
    actorId: string,
    input: {
      projectId: string
      taskRunId: string
      costLimitMicros: number
      tokenLimit: number
      configDigest: string
      now: Date
    },
  ): Promise<{ taskRun: AgentTaskRunRecord; transition: AgentTaskTransitionRecord } | 'invalid_state' | null>
  cancelAgentTaskRun?(
    actorId: string,
    input: { projectId: string; taskRunId: string; now: Date },
  ): Promise<{ taskRun: AgentTaskRunRecord; operationIds: string[] } | 'invalid_state' | null>
  getAgentTaskTransitionProviderResult?(
    actorId: string,
    taskRunId: string,
    transitionId: string,
  ): Promise<AgentTaskTransitionProviderResult | null>
  getAgentTaskPlanningInput?(
    actorId: string,
    projectId: string,
    taskRunId: string,
  ): Promise<Record<string, unknown> | null>
  enqueueAgentTaskTransition?(
    actorId: string,
    input: {
      taskRunId: string
      stepId?: string | null
      kind: AgentTaskTransitionKind
      transitionKey: string
      availableAt?: Date
      input?: Record<string, unknown>
      now: Date
    },
  ): Promise<AgentTaskTransitionRecord | 'conflict' | 'invalid_state' | null>
  createAgentTaskPlan?(
    actorId: string,
    taskRunId: string,
    input: NonNullable<AgentTaskCompletionInput['plan']> & { now: Date },
  ): Promise<{ plan: AgentTaskPlanRecord; steps: AgentTaskStepRecord[] } | 'invalid_state' | null>
  reviseAgentTaskPlan?(
    actorId: string,
    taskRunId: string,
    input: NonNullable<AgentTaskCompletionInput['plan']> & { now: Date },
  ): Promise<{ plan: AgentTaskPlanRecord; steps: AgentTaskStepRecord[] } | 'invalid_state' | null>
  appendAgentTaskEvent?(
    actorId: string,
    taskRunId: string,
    input: NonNullable<AgentTaskCompletionInput['events']>[number] & { now: Date },
  ): Promise<AgentTaskEventRecord | null>
  acquireAgentProjectTaskLease?(
    actorId: string,
    input: { taskRunId: string; workerId: string; now: Date; leaseUntil: Date },
  ): Promise<AgentProjectTaskLeaseRecord | 'busy' | 'stale' | null>
  acquireNextAgentProjectTaskLease?(
    workerId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<AgentProjectTaskLeaseRecord | null>
  releaseAgentProjectTaskLease?(
    actorId: string,
    input: { taskRunId: string; workerId: string; leaseGeneration: number; leaseToken: string; now: Date },
  ): Promise<true | 'stale'>
  claimAgentTaskTransition?(
    workerId: string,
    now: Date,
    leaseUntil: Date,
    kinds?: readonly AgentTaskTransitionKind[],
  ): Promise<AgentTaskTransitionRecord | null>
  heartbeatAgentTaskTransition?(
    actorId: string,
    fence: AgentTaskTransitionFence,
    now: Date,
    leaseUntil: Date,
  ): Promise<AgentTaskTransitionRecord | 'stale'>
  releaseAgentTaskTransition?(
    actorId: string,
    fence: AgentTaskTransitionFence,
    now: Date,
  ): Promise<AgentTaskTransitionRecord | 'stale'>
  completeAgentTaskTransition?(
    actorId: string,
    fence: AgentTaskTransitionFence,
    input: AgentTaskCompletionInput,
  ): Promise<
    | {
        transition: AgentTaskTransitionRecord
        taskRun: AgentTaskRunRecord
        nextTransition: AgentTaskTransitionRecord | null
      }
    | 'stale'
    | 'invalid_state'
    | 'conflict'
  >
  reconcileAgentTaskTransition?(
    actorId: string,
    fence: AgentTaskTransitionFence,
    now: Date,
  ): Promise<AgentTaskReconciliationResult | 'stale' | null>
  pauseAgentTaskTransitionUnknownOutcome?(
    actorId: string,
    fence: AgentTaskTransitionFence,
    input: {
      now: Date
      event: NonNullable<AgentTaskCompletionInput['events']>[number]
      operationalEvent: {
        dedupeKey: string
        code: string
        severity: AgentTaskOperationalEventRecord['severity']
        details?: Record<string, unknown>
      }
    },
  ): Promise<AgentTaskReconciliationResult | 'stale' | 'invalid_state'>
  reconcileAgentTaskTransitions?(now: Date, limit?: number): Promise<AgentTaskReconciliationResult[]>
  appendAgentTaskOperationalEvent?(
    actorId: string,
    input: {
      dedupeKey: string
      projectId?: string | null
      taskRunId?: string | null
      transitionId?: string | null
      operationId?: string | null
      code: string
      severity: AgentTaskOperationalEventRecord['severity']
      details?: Record<string, unknown>
      now: Date
    },
  ): Promise<AgentTaskOperationalEventRecord>
  ensurePersonalSpace(actorId: string): Promise<string>
  listProjects(actorId: string, scope?: 'active' | 'trashed'): Promise<ProjectSummaryRecord[]>
  createProject(
    actorId: string,
    input: { name: string; description?: string | null; coverUrl?: string | null; schema: ProjectSchema },
  ): Promise<ProjectRecord>
  startAgentProject?(
    actorId: string,
    input: {
      project: {
        id: string
        name: string
        description?: string | null
        coverUrl?: string | null
        schema: ProjectSchema
      }
      workspacePayload: Record<string, unknown>
      createLegacyDispatch?: boolean
      dispatch?: {
        conversationId: string
        taskId: string
        operationId: string
        waitingForUpload: boolean
      }
      idempotencyKey: string
      inputDigest: string
    },
  ): Promise<AgentProjectStartRecord | 'conflict'>
  getProject(actorId: string, projectId: string): Promise<ProjectRecord | null>
  listProjectMembers(actorId: string, projectId: string): Promise<ProjectMemberRecord[] | null>
  setProjectMemberRole(
    actorId: string,
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<ProjectMemberRecord | 'forbidden' | 'last_owner' | null>
  removeProjectMember(
    actorId: string,
    projectId: string,
    userId: string,
  ): Promise<true | 'forbidden' | 'last_owner' | null>
  getEditableProjectForAgentSpike(actorId: string, projectId: string): Promise<EditableAgentSpikeProject | null>
  issueAgentSpikeOperation(
    actorId: string,
    input: AgentSpikeOperationBinding & {
      baseDraftVersion: number
      inputDigest: string
      grantJti: string
      executorInput: Record<string, unknown>
      compatibility: Record<string, string>
      expiresAt: Date
      skillTrace?: AgentSkillTrace
    },
  ): Promise<AgentSpikeOperationRecord | 'conflict' | 'integrity_conflict' | 'invalid_state' | null>
  prepareAgentSpikeOperation(
    actorId: string,
    binding: AgentSpikeOperationBinding,
    input: {
      candidateSchema: ProjectSchema
      hostReceipt: Record<string, unknown>
      evidence: Record<string, unknown>
    },
  ): Promise<AgentSpikeOperationRecord | 'attempt_stale' | 'integrity_conflict' | 'invalid_state' | null>
  prepareAgentSpikeOperation(
    actorId: string,
    binding: AgentSpikeOperationBinding,
    authority: AgentMutationAuthority,
    input: {
      candidateSchema: ProjectSchema
      hostReceipt: Record<string, unknown>
      evidence: Record<string, unknown>
    },
  ): Promise<AgentSpikeOperationRecord | 'attempt_stale' | 'integrity_conflict' | 'invalid_state' | null>
  commitAgentSpikeStage(
    actorId: string,
    binding: AgentSpikeOperationBinding,
    authority?: AgentMutationAuthority,
  ): Promise<AgentSpikeOperationRecord | 'attempt_stale' | 'conflict' | 'integrity_conflict' | 'invalid_state' | null>
  getAgentSpikeOperationOutcome(actorId: string, operationId: string): Promise<AgentSpikeOperationRecord | null>
  getAgentSpikeOperationOutcomeByTask?(
    actorId: string,
    projectId: string,
    taskId: string,
  ): Promise<AgentSpikeOperationRecord | null>
  enqueueAgentRunDispatch?(
    actorId: string,
    input: { projectId: string; conversationId: string; taskId: string; operationId: string; now?: Date },
  ): Promise<AgentRunDispatchRecord | null>
  enqueueAgentTurn?(
    actorId: string,
    input: Omit<DurableAgentTurnRecord, 'actorId'> & { now: Date; reservationExpiresAt: Date },
  ): Promise<
    | { turn: DurableAgentTurnRecord; dispatch: AgentRunDispatchRecord; cost: AgentRunCostRecord }
    | 'conflict'
    | 'task_budget_exceeded'
    | 'project_budget_exceeded'
    | null
  >
  getAgentTurnByDispatch?(actorId: string, dispatchId: string): Promise<DurableAgentTurnRecord | null>
  prepareAgentProviderAttempt?(
    actorId: string,
    dispatchAttempt: AgentProviderAttemptFence,
    input: {
      projectId: string
      taskId: string
      turnId: string
      providerRequestKey: string | null
      requestBodyDigest: string
      idempotencyMode: 'unsupported' | 'stable'
      reservedMicros: number
      now: Date
    },
  ): Promise<
    DurableProviderAttemptRecord | 'task_budget_exceeded' | 'project_budget_exceeded' | 'outcome_unknown' | 'stale'
  >
  markAgentProviderAttemptStarted?(
    actorId: string,
    attemptId: string,
    dispatchAttempt: AgentProviderAttemptFence,
    now: Date,
  ): Promise<DurableProviderAttemptRecord | null>
  completeAgentProviderAttempt?(
    actorId: string,
    attemptId: string,
    dispatchAttempt: AgentProviderAttemptFence,
    input: {
      state: 'succeeded' | 'failed_definite' | 'outcome_unknown'
      providerAttempt: {
        providerRequestKey?: string
        requestBodyDigest: string
        idempotencyMode: 'unsupported' | 'stable'
        idempotencyHeaderSent: boolean
        upstreamRequestId?: string
        durationMs?: number
        reason?: string
      }
      decisionOutput?: Record<string, unknown>
      decisionUsage?: Record<string, unknown> | null
      decisionTrace?: Record<string, unknown>
      observedTokens?: number
      promptTokens?: number
      completionTokens?: number
      cachedTokens?: number
      estimatedMicros?: number
      providerAmountMicros?: number
      terminalTransitionFailure?: {
        code: string
        summary: string
        publicPayload: Record<string, unknown>
        technicalPayload: Record<string, unknown>
      }
      now: Date
    },
  ): Promise<AgentProviderAttemptSettlementResult | 'stale'>
  reconcileAgentProviderAttempt?(
    actorId: string,
    dispatchAttempt: TransitionProviderAttemptFence,
    now: Date,
  ): Promise<AgentProviderAttemptReconciliationResult | 'stale' | null>
  reconcileAgentProviderAttempt?(
    actorId: string,
    dispatchAttempt: DispatchProviderAttemptFence,
    now: Date,
  ): Promise<DurableProviderAttemptRecord | 'stale' | null>
  getAgentRunDispatch?(actorId: string, projectId: string, operationId: string): Promise<AgentRunDispatchRecord | null>
  getAgentRunDispatchByTask?(actorId: string, projectId: string, taskId: string): Promise<AgentRunDispatchRecord | null>
  claimAgentRunDispatch?(workerId: string, now: Date, leaseUntil: Date): Promise<AgentRunDispatchRecord | null>
  heartbeatAgentRunDispatch?(
    actorId: string,
    id: string,
    workerId: string,
    generation: number,
    now: Date,
    leaseUntil: Date,
  ): Promise<AgentRunDispatchRecord | null>
  controlAgentRunDispatch?(
    actorId: string,
    projectId: string,
    operationId: string,
    action: AgentRunDispatchControlAction,
    now: Date,
  ): Promise<AgentRunDispatchRecord | 'invalid_state' | null>
  finalizeAgentRunAttachments?(
    actorId: string,
    projectId: string,
    operationId: string,
    now: Date,
  ): Promise<{ dispatch: AgentRunDispatchRecord; transitioned: boolean } | null>
  markAgentRunDispatchWaiting?(
    actorId: string,
    projectId: string,
    operationId: string,
    reason: 'user',
    now: Date,
  ): Promise<AgentRunDispatchRecord | null>
  validateAgentRunDispatchAttempt?(
    actorId: string,
    projectId: string,
    operationId: string,
    attempt: { dispatchId: string; workerId: string; leaseGeneration: number },
    now: Date,
  ): Promise<boolean>
  finishAgentRunDispatch?(
    actorId: string,
    id: string,
    workerId: string,
    generation: number,
    state: Extract<AgentRunDispatchState, 'paused' | 'succeeded' | 'failed' | 'canceled' | 'indeterminate'>,
    error: { code: string; message: string } | null,
    now: Date,
  ): Promise<AgentRunDispatchRecord | null>
  getAgentRunCost?(actorId: string, projectId: string, taskId: string): Promise<AgentRunCostRecord | null>
  getAgentRunCostByTurn?(actorId: string, projectId: string, turnId: string): Promise<AgentRunCostRecord | null>
  reconcileAgentRunCost?(
    actorId: string,
    projectId: string,
    taskId: string,
    now: Date,
  ): Promise<AgentRunCostRecord | null>
  failAgentSpikeOperation?(
    actorId: string,
    binding: AgentSpikeOperationBinding,
    outcome: Record<string, unknown>,
  ): Promise<AgentSpikeOperationRecord | 'integrity_conflict' | 'invalid_state' | null>
  undoAgentSpikeOperation?(
    actorId: string,
    projectId: string,
    operationId: string,
  ): Promise<AgentRunUndoRecord | 'conflict' | 'invalid_state' | null>
  updateProject(
    actorId: string,
    projectId: string,
    input: { name?: string; description?: string | null; coverUrl?: string | null },
  ): Promise<ProjectRecord | null>
  setProjectFavorite(actorId: string, projectId: string, isFavorite: boolean): Promise<ProjectSummaryRecord | null>
  duplicateProject(actorId: string, projectId: string): Promise<ProjectRecord | null>
  trashProject(actorId: string, accessToken: string, projectId: string): Promise<boolean>
  permanentlyDeleteProject(actorId: string, accessToken: string, projectId: string): Promise<true | 'conflict' | null>
  restoreProject(actorId: string, projectId: string): Promise<ProjectRecord | 'deletion_in_progress' | null>
  saveDraft(
    actorId: string,
    projectId: string,
    expectedVersion: number,
    schema: ProjectSchema,
  ): Promise<ProjectRecord | 'conflict' | null>
  listRevisions(actorId: string, projectId: string): Promise<RevisionRecord[] | null>
  listReleases(actorId: string, projectId: string): Promise<ReleaseRecord[] | null>
  createRestorePoint(
    actorId: string,
    projectId: string,
    kind: Extract<RevisionKind, 'manual'>,
    label?: string | null,
  ): Promise<RevisionRecord | null>
  restoreRevision(
    actorId: string,
    projectId: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<ProjectRecord | 'conflict' | null>
  restoreRelease(
    actorId: string,
    projectId: string,
    releaseNumber: number,
    expectedVersion: number,
  ): Promise<ProjectRecord | 'conflict' | null>
  createPublishSnapshot(
    actorId: string,
    projectId: string,
    draftVersion: number,
  ): Promise<{ snapshot: ProjectPublishSnapshotRecord; previewRun: ProjectPreviewRunRecord | null } | 'conflict' | null>
  approvePublishSnapshot(
    actorId: string,
    projectId: string,
    snapshotId: string,
  ): Promise<ProjectPublishApprovalRecord | 'preview_required' | 'forbidden' | null>
  publish(
    actorId: string,
    projectId: string,
    input: { snapshotId: string },
  ): Promise<PublishProjectResult | 'approval_required' | 'forbidden' | null>
  unpublish(actorId: string, projectId: string): Promise<boolean | 'forbidden'>
  isPublicProjectAvailable(slug: string, releaseNumber?: number): Promise<boolean>
  getPublicProject(slug: string): Promise<PublicProject | null>
  getPublicProjectVersion(slug: string, releaseNumber: number): Promise<PublicProject | null>
  createThumbnailUpload(
    actorId: string,
    accessToken: string,
    projectId: string,
    input: {
      draftVersion: number
      mode: ThumbnailMode
      source: ThumbnailSource
      contentType: 'image/webp' | 'image/svg+xml'
      size: number
    },
  ): Promise<ThumbnailUploadContract | 'conflict' | null>
  completeThumbnailUpload(
    actorId: string,
    accessToken: string,
    projectId: string,
    input: { draftVersion: number; path: string },
  ): Promise<ProjectSummaryRecord | 'conflict' | 'invalid' | null>
  failThumbnailUpload(
    actorId: string,
    accessToken: string,
    projectId: string,
    input: { draftVersion: number; path: string; errorCode: string },
  ): Promise<boolean | 'conflict'>
  reconcileThumbnailArtifacts(
    actorId: string,
    accessToken: string,
    projectId: string,
  ): Promise<ThumbnailReconcileResult | null>
  getThumbnailDownloadUrl(actorId: string, accessToken: string, projectId: string): Promise<string | null>
  createAgentAssetUpload?(
    actorId: string,
    accessToken: string,
    projectId: string,
    input: {
      idempotencyKey: string
      scope: AgentAssetScope
      conversationId?: string | null
      name: string
      contentType: string
      size: number
    },
  ): Promise<AgentAssetUploadContract | 'conflict' | 'quota' | null>
  completeAgentAssetUpload?(
    actorId: string,
    accessToken: string,
    projectId: string,
    input: { id: string; path: string },
  ): Promise<AgentAssetRecord | 'invalid' | null>
  getAgentAsset?(actorId: string, projectId: string, id: string): Promise<AgentAssetRecord | null>
  getAgentAssetModelInput?(
    actorId: string,
    projectId: string,
    assetId: string,
  ): Promise<
    | {
        record: { contentType: 'image/png' | 'image/jpeg' | 'image/webp'; size: number; sha256: string }
        bytes: Uint8Array
      }
    | 'unsupported'
    | 'oversize'
    | null
  >
  persistAgentAssetModelInput?(
    actorId: string,
    projectId: string,
    assetId: string,
    input: {
      record: { contentType: 'image/png' | 'image/jpeg' | 'image/webp'; size: number; sha256: string }
      bytes: Uint8Array
    },
  ): Promise<boolean>
  listAgentAssets?(actorId: string, projectId: string, conversationId?: string): Promise<AgentAssetRecord[]>
  getAgentAssetDownloadUrl?(actorId: string, accessToken: string, projectId: string, id: string): Promise<string | null>
  deleteAgentAsset?(actorId: string, accessToken: string, projectId: string, id: string): Promise<boolean>
  createAgentScreenshotArtifactUpload?(
    actorId: string,
    accessToken: string,
    projectId: string,
    operationId: string,
    input: {
      candidateSha256: string
      draftVersion: number
      contentType: 'image/png'
      size: number
      sha256: string
    },
  ): Promise<AgentScreenshotArtifactUploadContract | 'conflict' | 'invalid_state' | null>
  completeAgentScreenshotArtifactUpload?(
    actorId: string,
    accessToken: string,
    projectId: string,
    operationId: string,
    input: { artifactId: string; path: string },
  ): Promise<AgentScreenshotArtifactRecord | 'invalid' | 'integrity_conflict' | null>
  getAgentScreenshotArtifactDownload?(
    actorId: string,
    accessToken: string,
    projectId: string,
    operationId: string,
  ): Promise<AgentScreenshotArtifactDownloadContract | null>
  getAgentScreenshotArtifactModelInput?(
    actorId: string,
    storageSecret: string,
    projectId: string,
    operationId: string,
  ): Promise<{ record: AgentScreenshotArtifactRecord; bytes: Uint8Array } | 'oversize' | null>
  persistAgentScreenshotArtifact?(
    actorId: string,
    storageSecret: string,
    projectId: string,
    operationId: string,
    bytes: Uint8Array,
  ): Promise<AgentScreenshotArtifactRecord | 'conflict' | 'invalid_state' | null>
  reserveAgentRunCost?(
    actorId: string,
    input: {
      projectId: string
      taskId: string
      turnId: string
      inputDigest: string
      estimatedMicros: number
      taskLimitMicros: number
      projectMonthLimitMicros: number
      operationId?: string
      provider?: string
      model?: string
      profile?: string
      traceId?: string
      billingScope: 'project' | 'user'
      payerId: string
      now: Date
      reservationExpiresAt: Date
    },
  ): Promise<AgentRunCostRecord | 'conflict' | 'task_budget_exceeded' | 'project_budget_exceeded' | null>
  settleAgentRunCost?(
    actorId: string,
    input: {
      projectId: string
      taskId: string
      turnId: string
      settledMicros: number
      minimumMicros?: number
      maximumMicros?: number
      promptTokens?: number
      completionTokens?: number
      indeterminate?: boolean
      decisionOutput?: Record<string, unknown> | null
      decisionUsage?: Record<string, unknown> | null
      decisionTrace?: Record<string, unknown> | null
    },
  ): Promise<AgentRunCostRecord | null>
  releaseAgentRunCost?(actorId: string, projectId: string, taskId: string): Promise<AgentRunCostRecord | null>
  getAgentBudgetUsage?(
    actorId: string,
    input: {
      projectId: string
      taskId: string
      billingScope: 'project' | 'user'
      payerId: string
    },
  ): Promise<AgentBudgetUsageRecord | null>
  respondToAgentTask?(
    actorId: string,
    input: {
      projectId: string
      conversationId: string
      taskId: string
      questionId: string
      turnId: string
      response: string
      attachmentIds: string[]
      providerInputSnapshot: AgentProviderInputSnapshot
      reservedMicros: number
      now: Date
    },
  ): Promise<
    | { dispatch: AgentRunDispatchRecord }
    | 'conflict'
    | 'invalid_question'
    | 'task_budget_exceeded'
    | 'project_budget_exceeded'
    | 'forbidden'
    | null
  >
  isProjectOwner?(actorId: string, projectId: string): Promise<boolean>
  getAgentProjectModelConfig?(actorId: string, projectId: string): Promise<Record<string, unknown> | null>
  updateAgentProjectModelConfig?(actorId: string, projectId: string, config: Record<string, unknown>): Promise<boolean>
  compareAndSetAgentProjectModelConfig?(
    actorId: string,
    projectId: string,
    expected: Record<string, unknown>,
    config: Record<string, unknown>,
  ): Promise<boolean>
  listTemplates(): Promise<Array<Record<string, unknown>>>
  getSettings(actorId: string): Promise<Record<string, unknown>>
  updateSettings(actorId: string, settings: Record<string, unknown>): Promise<Record<string, unknown>>
  getAgentUserPreferenceMemory?(actorId: string): Promise<AgentUserPreferenceMemory>
  compareAndSetAgentUserPreferenceMemory?(
    actorId: string,
    expectedRevision: number,
    memory: AgentUserPreferenceMemory,
  ): Promise<boolean>
  compareAndSetAgentUserModelConfig?(
    actorId: string,
    expected: Record<string, unknown>,
    config: Record<string, unknown>,
  ): Promise<boolean>
  getAgentWorkspace?(actorId: string, projectId: string): Promise<AgentWorkspaceRecord | null>
  upsertAgentWorkspace?(
    actorId: string,
    projectId: string,
    payload: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<AgentWorkspaceRecord | 'conflict' | null>
  listAgentProjectContexts?(actorId: string, projectId: string): Promise<AgentProjectContextRecord[] | null>
  upsertAgentProjectContext?(
    actorId: string,
    projectId: string,
    input: {
      id?: string
      expectedRevision?: number
      title: string
      content: string
      sourceTaskId?: string
      provenance?: AgentProjectContextProvenance
    },
  ): Promise<AgentProjectContextRecord | 'conflict' | null>
  rollbackAgentProjectContext?(
    actorId: string,
    projectId: string,
    id: string,
    expectedRevision: number,
    targetRevision: number,
  ): Promise<AgentProjectContextRecord | 'conflict' | null>
  deleteAgentProjectContext?(
    actorId: string,
    projectId: string,
    id: string,
    expectedRevision: number,
  ): Promise<true | 'conflict' | null>
}
