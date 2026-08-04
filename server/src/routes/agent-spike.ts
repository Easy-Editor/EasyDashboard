import { createHash, randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AgentSkillTrace, agentSkillTraceMatches, agentSkillTraceSchema } from '../agent/agent-skill-trace.js'
import { canonicalizeDashboardDocument } from '../agent/canonical-dashboard-document.js'
import {
  type CompatibilityTuple,
  type DocumentDescriptor,
  EXECUTOR_CONTRACT_VERSION,
  EXECUTOR_GRANT_AUDIENCE,
  EXECUTOR_GRANT_ISSUER,
  EXECUTOR_GRANT_SCOPES,
  ExecutorContractError,
  type ExecutorGrantPayload,
  type ExecutorGrantScope,
  type ExecutorPrepareInput,
  type ExecutorPreparedResult,
  MAX_EXECUTOR_GRANT_LIFETIME_SECONDS,
  MAX_EXECUTOR_RECOVERY_GRANT_LIFETIME_SECONDS,
  authorizeExecutorPrepare,
  compatibilityTupleSchema,
  createDocumentDescriptor,
  executorPrepareInputSchema,
  executorPreparedResultSchema,
  hashCompatibilityTuple,
  hashExecutorPrepareInput,
  mintExecutorGrant,
  parseDurableCommitReceipt,
  parseExecutorPrepareInput,
  validatePreparedResult,
  verifyExecutorGrantForScope,
} from '../agent/executor-contract.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type {
  AgentMutationAuthority,
  AgentSpikeOperationBinding,
  AgentSpikeOperationRecord,
  Repository,
} from '../types.js'
import { ValidationError, assertCanvasDimensions, assertSchemaBudget, projectIdSchema } from '../validation.js'

const operationIdSchema = z.string().trim().min(1).max(160)
const issueOperationSchema = executorPrepareInputSchema
  .pick({
    executorId: true,
    operationId: true,
    taskId: true,
    stageId: true,
    compatibility: true,
    invocation: true,
  })
  .strict()
const commitRequestSchema = z
  .object({
    candidateSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
const RECOVERY_GRANT_SCOPES = ['outcome:read'] as const satisfies readonly ExecutorGrantScope[]

type OperationGrantAuthority = 'mutation' | 'recovery'
type AcceptedGrantAuthority = OperationGrantAuthority | 'mutation-or-recovery'

export interface AgentSpikeRouteOptions {
  repository: Repository
  grantSecret?: string
  expectedCompatibility?: CompatibilityTuple
  now?: () => Date
  createGrantId?: () => string
}

export type AgentSpikeIssueRequest = Pick<
  ExecutorPrepareInput,
  'executorId' | 'operationId' | 'taskId' | 'stageId' | 'compatibility' | 'invocation'
> & { trace?: AgentSkillTrace }

export interface IssuedAgentSpikeOperation {
  operation: AgentSpikeOperationRecord
  input: ExecutorPrepareInput
  grant: string
  recoveryGrant: string
}

export interface ClaimedDispatchAttempt {
  dispatchId: string
  workerId: string
  leaseGeneration: number
}

function currentDate(options: AgentSpikeRouteOptions): Date {
  return options.now?.() ?? new Date()
}

function executorConfiguration(options: AgentSpikeRouteOptions): {
  grantSecret: string
  expectedCompatibility: CompatibilityTuple
} {
  if (!options.grantSecret || !options.expectedCompatibility) {
    throw new ApiError(503, 'AGENT_SPIKE_UNAVAILABLE', 'The isolated Agent executor is not configured')
  }
  return {
    grantSecret: options.grantSecret,
    expectedCompatibility: options.expectedCompatibility,
  }
}

function projectIdFrom(c: { req: { param(name: string): string } }): string {
  const result = projectIdSchema.safeParse(c.req.param('projectId'))
  if (!result.success) throw new ApiError(404, 'PROJECT_NOT_EDITABLE', 'Editable project not found')
  return result.data
}

function operationIdFrom(c: { req: { param(name: string): string } }): string {
  const result = operationIdSchema.safeParse(c.req.param('operationId'))
  if (!result.success) throw new ApiError(404, 'AGENT_OPERATION_NOT_FOUND', 'Agent operation not found')
  return result.data
}

function assertProjectBudget(schema: Record<string, unknown>): void {
  try {
    assertCanvasDimensions(schema)
    assertSchemaBudget(schema)
  } catch (error) {
    if (error instanceof ValidationError) {
      const status = error.code === 'INVALID_CANVAS_DIMENSION' ? 422 : 413
      throw new ApiError(status, error.code, error.message)
    }
    throw error
  }
}

function executorContractApiError(error: unknown, invalidCode: string): ApiError {
  if (!(error instanceof ExecutorContractError)) {
    throw error
  }
  if (error.code === 'INSUFFICIENT_GRANT_SCOPE') {
    return new ApiError(403, 'AGENT_GRANT_SCOPE_REQUIRED', error.message)
  }
  if (error.code === 'AUTHORITY_MISMATCH') {
    return new ApiError(403, 'AGENT_GRANT_AUTHORITY_MISMATCH', error.message)
  }
  if (
    error.code === 'INVALID_GRANT_TOKEN' ||
    error.code === 'INVALID_GRANT_SIGNATURE' ||
    error.code === 'GRANT_EXPIRED' ||
    error.code === 'GRANT_NOT_YET_VALID'
  ) {
    return new ApiError(401, 'AGENT_GRANT_INVALID', error.message)
  }
  return new ApiError(422, invalidCode, error.message)
}

function bearerToken(authorization: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization ?? '')
  if (!match?.[1]) {
    throw new ApiError(401, 'AGENT_GRANT_REQUIRED', 'A signed executor bearer grant is required')
  }
  return match[1]
}

function verifyRouteGrant(
  authorization: string | undefined,
  operationId: string,
  requiredScope: ExecutorGrantScope,
  options: AgentSpikeRouteOptions,
  acceptedAuthority: AcceptedGrantAuthority = 'mutation',
): { token: string; grant: ExecutorGrantPayload; authority: OperationGrantAuthority } {
  const { grantSecret } = executorConfiguration(options)
  const token = bearerToken(authorization)
  let grant: ExecutorGrantPayload
  try {
    grant = verifyExecutorGrantForScope(token, grantSecret, requiredScope, {
      now: currentDate(options),
    })
  } catch (error) {
    throw executorContractApiError(error, 'AGENT_GRANT_INVALID')
  }
  if (grant.iss !== EXECUTOR_GRANT_ISSUER || grant.operationId !== operationId) {
    throw new ApiError(
      403,
      'AGENT_GRANT_AUTHORITY_MISMATCH',
      'Executor grant is not authorized for this operation route',
    )
  }
  const authority = operationGrantAuthority(grant)
  if (!authority || (acceptedAuthority !== 'mutation-or-recovery' && authority !== acceptedAuthority)) {
    throw new ApiError(
      403,
      'AGENT_GRANT_SCOPE_REQUIRED',
      'Executor grant does not have the exact authority required by this route',
    )
  }
  return { token, grant, authority }
}

function hasExactScopes(grant: ExecutorGrantPayload, expected: readonly ExecutorGrantScope[]): boolean {
  return grant.scopes.length === expected.length && grant.scopes.every((scope, index) => scope === expected[index])
}

function operationGrantAuthority(grant: ExecutorGrantPayload): OperationGrantAuthority | null {
  if (hasExactScopes(grant, EXECUTOR_GRANT_SCOPES)) return 'mutation'
  if (hasExactScopes(grant, RECOVERY_GRANT_SCOPES)) return 'recovery'
  return null
}

function bindingFrom(operation: AgentSpikeOperationRecord): AgentSpikeOperationBinding {
  return {
    projectId: operation.projectId,
    taskId: operation.taskId,
    stageId: operation.stageId,
    executorId: operation.executorId,
    operationId: operation.operationId,
  }
}

function durableCommitReceipt(operation: AgentSpikeOperationRecord) {
  if (operation.status !== 'committed') return null
  if (
    !operation.candidateSchema ||
    !operation.candidateDigest ||
    !operation.committedDraftVersion ||
    !operation.completedAt
  ) {
    throw new ApiError(
      409,
      'AGENT_OPERATION_INTEGRITY_CONFLICT',
      'Committed operation is missing its durable receipt evidence',
    )
  }

  let input: ExecutorPrepareInput
  let candidate: DocumentDescriptor
  try {
    input = parseExecutorPrepareInput(operation.executorInput)
    candidate = createDocumentDescriptor(operation.candidateSchema as DocumentDescriptor['schema'])
  } catch (error) {
    throw executorContractApiError(error, 'AGENT_OPERATION_INTEGRITY_CONFLICT')
  }
  if (candidate.sha256 !== operation.candidateDigest) {
    throw new ApiError(
      409,
      'AGENT_OPERATION_INTEGRITY_CONFLICT',
      'Committed operation candidate digest is inconsistent',
    )
  }

  try {
    return parseDurableCommitReceipt({
      contractVersion: EXECUTOR_CONTRACT_VERSION,
      receiptVersion: 'easy-dashboard.cas-commit-receipt.v1',
      receiptId: operation.id,
      operationId: operation.operationId,
      projectId: operation.projectId,
      actorId: operation.actorId,
      taskId: operation.taskId,
      stageId: operation.stageId,
      baseDraftVersion: operation.baseDraftVersion,
      committedDraftVersion: operation.committedDraftVersion,
      inputSha256: operation.inputDigest,
      compatibilitySha256: hashCompatibilityTuple(input.compatibility),
      candidateSha256: candidate.sha256,
      candidateBytes: candidate.bytes,
      committedAt: operation.completedAt.toISOString(),
      repositoryWitness: {
        kind: 'hono.repository.cas',
        transactionId: operation.id,
      },
    })
  } catch (error) {
    throw executorContractApiError(error, 'AGENT_OPERATION_INTEGRITY_CONFLICT')
  }
}

export function operationOutcome(operation: AgentSpikeOperationRecord) {
  return {
    operationId: operation.operationId,
    projectId: operation.projectId,
    baseDraftVersion: operation.baseDraftVersion,
    status: operation.status,
    candidateSha256: operation.candidateDigest,
    committedDraftVersion: operation.committedDraftVersion,
    rollbackRevisionId: operation.rollbackRevisionId,
    outcome: operation.outcome,
    trace: operation.skillTrace ?? null,
    commitReceipt: durableCommitReceipt(operation),
    preparedAt: operation.preparedAt,
    completedAt: operation.completedAt,
  }
}

function persistedIssueInput(
  operation: AgentSpikeOperationRecord,
  actorId: string,
  projectId: string,
  requested: z.infer<typeof issueOperationSchema>,
): ExecutorPrepareInput | null {
  let input: ExecutorPrepareInput
  try {
    input = parseExecutorPrepareInput(operation.executorInput)
  } catch (error) {
    if (error instanceof ExecutorContractError) return null
    throw error
  }
  const persistedCompatibility = compatibilityTupleSchema.safeParse(operation.compatibility)
  if (!persistedCompatibility.success) return null
  const reboundInput = parseExecutorPrepareInput({
    ...input,
    executorId: requested.executorId,
    operationId: requested.operationId,
    taskId: requested.taskId,
    stageId: requested.stageId,
    compatibility: requested.compatibility,
    invocation: requested.invocation,
  })
  return operation.actorId === actorId &&
    operation.projectId === projectId &&
    input.actorId === operation.actorId &&
    input.projectId === operation.projectId &&
    operation.executorId === input.executorId &&
    operation.operationId === input.operationId &&
    operation.taskId === input.taskId &&
    operation.stageId === input.stageId &&
    operation.baseDraftVersion === input.baseDraftVersion &&
    operation.inputDigest === hashExecutorPrepareInput(input) &&
    operation.inputDigest === hashExecutorPrepareInput(reboundInput) &&
    hashCompatibilityTuple(persistedCompatibility.data) === hashCompatibilityTuple(input.compatibility)
    ? input
    : null
}

function persistedExecutionInput(
  operation: AgentSpikeOperationRecord,
  actorId: string,
  operationId: string,
): ExecutorPrepareInput {
  let input: ExecutorPrepareInput
  try {
    input = parseExecutorPrepareInput(operation.executorInput)
  } catch (error) {
    throw executorContractApiError(error, 'AGENT_OPERATION_INTEGRITY_CONFLICT')
  }
  const persistedCompatibility = compatibilityTupleSchema.safeParse(operation.compatibility)
  const matches =
    persistedCompatibility.success &&
    operation.actorId === actorId &&
    operation.operationId === operationId &&
    input.actorId === operation.actorId &&
    input.projectId === operation.projectId &&
    input.taskId === operation.taskId &&
    input.stageId === operation.stageId &&
    input.executorId === operation.executorId &&
    input.operationId === operation.operationId &&
    input.baseDraftVersion === operation.baseDraftVersion &&
    operation.inputDigest === hashExecutorPrepareInput(input) &&
    hashCompatibilityTuple(persistedCompatibility.data) === hashCompatibilityTuple(input.compatibility)
  if (!matches) {
    throw new ApiError(
      409,
      'AGENT_OPERATION_INTEGRITY_CONFLICT',
      'Persisted Agent operation does not match its executor input',
    )
  }
  return input
}

function assertPreparedEvidence(prepared: ExecutorPreparedResult): void {
  const hasConsoleError =
    prepared.evidence.consoleErrors.length > 0 || prepared.evidence.console.some(entry => entry.level === 'error')
  const hasResourceFailure =
    prepared.evidence.requestFailures.length > 0 ||
    prepared.evidence.render.resourceErrors.length > 0 ||
    prepared.evidence.materials.missing.length > 0
  if (
    hasConsoleError ||
    hasResourceFailure ||
    prepared.evidence.render.status !== 'rendered' ||
    !prepared.evidence.render.screenshotSha256
  ) {
    throw new ApiError(
      422,
      'AGENT_EXECUTOR_EVIDENCE_FAILED',
      'Executor evidence must prove a clean render before candidate preparation',
    )
  }
}

function mintOperationGrant(
  operation: AgentSpikeOperationRecord,
  input: ExecutorPrepareInput,
  secret: string,
  now: Date,
  dispatchAttempt?: ClaimedDispatchAttempt,
): string {
  const nowSeconds = Math.floor(now.getTime() / 1_000)
  const expiresAt = dispatchAttempt
    ? nowSeconds + MAX_EXECUTOR_GRANT_LIFETIME_SECONDS
    : Math.floor(operation.expiresAt.getTime() / 1_000)
  if (!dispatchAttempt && expiresAt <= nowSeconds) {
    throw new ApiError(409, 'AGENT_OPERATION_INVALID_STATE', 'Agent operation grant has expired')
  }
  const issuedAt = dispatchAttempt ? nowSeconds : expiresAt - MAX_EXECUTOR_GRANT_LIFETIME_SECONDS
  const grantJti = dispatchAttempt
    ? `attempt:${createHash('sha256')
        .update(
          `${operation.id}\0${dispatchAttempt.dispatchId}\0${dispatchAttempt.workerId}\0${dispatchAttempt.leaseGeneration}`,
        )
        .digest('hex')}`
    : operation.grantJti
  return mintExecutorGrant(
    {
      contractVersion: EXECUTOR_CONTRACT_VERSION,
      iss: EXECUTOR_GRANT_ISSUER,
      aud: EXECUTOR_GRANT_AUDIENCE,
      executorId: input.executorId,
      jti: grantJti,
      operationId: input.operationId,
      projectId: input.projectId,
      actorId: input.actorId,
      taskId: input.taskId,
      stageId: input.stageId,
      baseDraftVersion: input.baseDraftVersion,
      inputSha256: operation.inputDigest,
      compatibilitySha256: hashCompatibilityTuple(input.compatibility),
      ...(dispatchAttempt ? { dispatchAttempt } : {}),
      scopes: [...EXECUTOR_GRANT_SCOPES],
      iat: issuedAt,
      nbf: issuedAt,
      exp: expiresAt,
    },
    secret,
  )
}

function recoveryGrantIssuedAt(operation: AgentSpikeOperationRecord): number {
  return Math.floor(operation.createdAt.getTime() / 1_000)
}

function recoveryGrantJti(operation: AgentSpikeOperationRecord): string {
  const digest = createHash('sha256')
    .update('easy-dashboard.executor.recovery-grant.v1', 'utf8')
    .update('\0', 'utf8')
    .update(operation.id, 'utf8')
    .update('\0', 'utf8')
    .update(operation.createdAt.toISOString(), 'utf8')
    .update('\0', 'utf8')
    .update(operation.inputDigest, 'utf8')
    .digest('hex')
  return `recovery:${digest}`
}

function mintOperationRecoveryGrant(
  operation: AgentSpikeOperationRecord,
  input: ExecutorPrepareInput,
  secret: string,
): string {
  const issuedAt = recoveryGrantIssuedAt(operation)
  return mintExecutorGrant(
    {
      contractVersion: EXECUTOR_CONTRACT_VERSION,
      iss: EXECUTOR_GRANT_ISSUER,
      aud: EXECUTOR_GRANT_AUDIENCE,
      executorId: input.executorId,
      jti: recoveryGrantJti(operation),
      operationId: input.operationId,
      projectId: input.projectId,
      actorId: input.actorId,
      taskId: input.taskId,
      stageId: input.stageId,
      baseDraftVersion: input.baseDraftVersion,
      inputSha256: operation.inputDigest,
      compatibilitySha256: hashCompatibilityTuple(input.compatibility),
      scopes: [...RECOVERY_GRANT_SCOPES],
      iat: issuedAt,
      nbf: issuedAt,
      exp: issuedAt + MAX_EXECUTOR_RECOVERY_GRANT_LIFETIME_SECONDS,
    },
    secret,
  )
}

function operationMatchesGrant(
  operation: AgentSpikeOperationRecord,
  input: ExecutorPrepareInput,
  grant: ExecutorGrantPayload,
  authority: OperationGrantAuthority,
): boolean {
  const persistedCompatibility = compatibilityTupleSchema.safeParse(operation.compatibility)
  if (!persistedCompatibility.success) return false
  const inputSha256 = hashExecutorPrepareInput(input)
  const compatibilitySha256 = hashCompatibilityTuple(input.compatibility)
  const mutationExpiresAt = Math.floor(operation.expiresAt.getTime() / 1_000)
  const mutationIssuedAt = mutationExpiresAt - MAX_EXECUTOR_GRANT_LIFETIME_SECONDS
  const recoveryIssuedAt = recoveryGrantIssuedAt(operation)
  const authorityMatches =
    authority === 'mutation'
      ? (grant.dispatchAttempt
          ? grant.jti ===
            `attempt:${createHash('sha256')
              .update(
                `${operation.id}\0${grant.dispatchAttempt.dispatchId}\0${grant.dispatchAttempt.workerId}\0${grant.dispatchAttempt.leaseGeneration}`,
              )
              .digest('hex')}`
          : operation.grantJti === grant.jti &&
            grant.iat === mutationIssuedAt &&
            grant.nbf === mutationIssuedAt &&
            grant.exp === mutationExpiresAt) &&
        hasExactScopes(grant, EXECUTOR_GRANT_SCOPES) &&
        grant.nbf === grant.iat &&
        grant.exp - grant.iat === MAX_EXECUTOR_GRANT_LIFETIME_SECONDS
      : recoveryGrantJti(operation) === grant.jti &&
        !grant.dispatchAttempt &&
        hasExactScopes(grant, RECOVERY_GRANT_SCOPES) &&
        grant.iat === recoveryIssuedAt &&
        grant.nbf === recoveryIssuedAt &&
        grant.exp === recoveryIssuedAt + MAX_EXECUTOR_RECOVERY_GRANT_LIFETIME_SECONDS
  return (
    authorityMatches &&
    operation.actorId === grant.actorId &&
    operation.projectId === grant.projectId &&
    operation.taskId === grant.taskId &&
    operation.stageId === grant.stageId &&
    operation.executorId === grant.executorId &&
    operation.operationId === grant.operationId &&
    operation.baseDraftVersion === grant.baseDraftVersion &&
    operation.inputDigest === grant.inputSha256 &&
    operation.inputDigest === inputSha256 &&
    hashCompatibilityTuple(persistedCompatibility.data) === grant.compatibilitySha256 &&
    compatibilitySha256 === grant.compatibilitySha256 &&
    input.actorId === operation.actorId &&
    input.projectId === operation.projectId &&
    input.taskId === operation.taskId &&
    input.stageId === operation.stageId &&
    input.executorId === operation.executorId &&
    input.operationId === operation.operationId &&
    input.baseDraftVersion === operation.baseDraftVersion
  )
}

async function loadBoundOperation(
  options: AgentSpikeRouteOptions,
  grant: ExecutorGrantPayload,
  authority: OperationGrantAuthority,
): Promise<{ operation: AgentSpikeOperationRecord; input: ExecutorPrepareInput }> {
  const operation = await options.repository.getAgentSpikeOperationOutcome(grant.actorId, grant.operationId)
  if (!operation) throw new ApiError(404, 'AGENT_OPERATION_NOT_FOUND', 'Agent operation not found')

  let input: ExecutorPrepareInput
  try {
    input = parseExecutorPrepareInput(operation.executorInput)
  } catch (error) {
    throw executorContractApiError(error, 'AGENT_OPERATION_INTEGRITY_CONFLICT')
  }
  if (!operationMatchesGrant(operation, input, grant, authority)) {
    throw new ApiError(
      403,
      'AGENT_GRANT_AUTHORITY_MISMATCH',
      'Executor grant does not match the persisted operation authority',
    )
  }
  return { operation, input }
}

function mapIssueResult(
  result: AgentSpikeOperationRecord | 'conflict' | 'integrity_conflict' | 'invalid_state' | null,
): AgentSpikeOperationRecord {
  if (result === 'conflict') {
    throw new ApiError(409, 'AGENT_DRAFT_STALE', 'The project draft changed before operation issuance')
  }
  if (result === 'integrity_conflict') {
    throw new ApiError(
      409,
      'AGENT_OPERATION_INTEGRITY_CONFLICT',
      'Operation id is already bound to different executor input',
    )
  }
  if (result === 'invalid_state') {
    throw new ApiError(409, 'AGENT_OPERATION_INVALID_STATE', 'Agent operation cannot be issued in its current state')
  }
  if (!result) throw new ApiError(404, 'PROJECT_NOT_EDITABLE', 'Editable project not found')
  return result
}

function mapPreparedResult(
  result: AgentSpikeOperationRecord | 'attempt_stale' | 'integrity_conflict' | 'invalid_state' | null,
): AgentSpikeOperationRecord {
  if (result === 'attempt_stale') {
    throw new ApiError(409, 'AGENT_EXECUTOR_ATTEMPT_STALE', 'Executor dispatch attempt is no longer current')
  }
  if (result === 'integrity_conflict') {
    throw new ApiError(
      409,
      'AGENT_OPERATION_INTEGRITY_CONFLICT',
      'Prepared candidate does not match the persisted operation',
    )
  }
  if (result === 'invalid_state') {
    throw new ApiError(409, 'AGENT_OPERATION_INVALID_STATE', 'Agent operation cannot be prepared in its current state')
  }
  if (!result) throw new ApiError(404, 'AGENT_OPERATION_NOT_FOUND', 'Agent operation not found')
  return result
}

function mapCommitResult(
  result: AgentSpikeOperationRecord | 'attempt_stale' | 'conflict' | 'integrity_conflict' | 'invalid_state' | null,
): AgentSpikeOperationRecord {
  if (result === 'attempt_stale') {
    throw new ApiError(409, 'AGENT_EXECUTOR_ATTEMPT_STALE', 'Executor dispatch attempt is no longer current')
  }
  if (result === 'conflict') {
    throw new ApiError(409, 'AGENT_DRAFT_STALE', 'The project draft changed before Agent commit')
  }
  if (result === 'integrity_conflict') {
    throw new ApiError(
      409,
      'AGENT_OPERATION_INTEGRITY_CONFLICT',
      'Committed candidate does not match the persisted operation',
    )
  }
  if (result === 'invalid_state') {
    throw new ApiError(409, 'AGENT_OPERATION_INVALID_STATE', 'Agent operation is not prepared for commit')
  }
  if (!result) throw new ApiError(404, 'AGENT_OPERATION_NOT_FOUND', 'Agent operation not found')
  return result
}

/**
 * Issues the same durable, least-authority executor operation used by the
 * diagnostic HTTP route. Product Agent runs call this function directly so
 * bearer grants never cross the browser boundary or get copied through an
 * internal HTTP request.
 */
export async function issueAgentSpikeOperation(
  options: AgentSpikeRouteOptions,
  actorId: string,
  projectIdValue: string,
  value: AgentSpikeIssueRequest,
): Promise<IssuedAgentSpikeOperation> {
  const { grantSecret, expectedCompatibility } = executorConfiguration(options)
  const projectIdResult = projectIdSchema.safeParse(projectIdValue)
  if (!projectIdResult.success) throw new ApiError(404, 'PROJECT_NOT_EDITABLE', 'Editable project not found')
  const projectId = projectIdResult.data
  const { trace: requestedTrace, ...operationValue } = value
  const requestedResult = issueOperationSchema.safeParse(operationValue)
  if (!requestedResult.success) {
    throw new ApiError(422, 'VALIDATION_FAILED', requestedResult.error.issues.map(issue => issue.message).join('; '))
  }
  const requested = requestedResult.data
  const traceResult =
    requestedTrace === undefined
      ? { success: true as const, data: null }
      : agentSkillTraceSchema.safeParse(requestedTrace)
  if (!traceResult.success) {
    throw new ApiError(422, 'VALIDATION_FAILED', traceResult.error.issues.map(issue => issue.message).join('; '))
  }
  const skillTrace = traceResult.data
  if (hashCompatibilityTuple(requested.compatibility) !== hashCompatibilityTuple(expectedCompatibility)) {
    throw new ApiError(
      409,
      'AGENT_EXECUTOR_COMPATIBILITY_MISMATCH',
      'Requested executor compatibility does not match the deployed artifact lock',
    )
  }
  const project = await options.repository.getEditableProjectForAgentSpike(actorId, projectId)
  if (!project) throw new ApiError(404, 'PROJECT_NOT_EDITABLE', 'Editable project not found')

  const now = currentDate(options)
  let operation = await options.repository.getAgentSpikeOperationOutcome(actorId, requested.operationId)
  if (operation && !agentSkillTraceMatches(operation.skillTrace ?? null, skillTrace)) {
    throw new ApiError(
      409,
      'AGENT_OPERATION_INTEGRITY_CONFLICT',
      'Operation id is already bound to a different Agent Skill trace',
    )
  }
  let input = operation ? persistedIssueInput(operation, actorId, projectId, requested) : null
  if (operation && !input) {
    throw new ApiError(
      409,
      'AGENT_OPERATION_INTEGRITY_CONFLICT',
      'Operation id is already bound to different executor input',
    )
  }
  if (!operation || !input) {
    input = parseExecutorPrepareInput({
      contractVersion: EXECUTOR_CONTRACT_VERSION,
      executorId: requested.executorId,
      operationId: requested.operationId,
      projectId,
      actorId,
      taskId: requested.taskId,
      stageId: requested.stageId,
      baseDraftVersion: project.draftVersion,
      compatibility: requested.compatibility,
      baseProject: createDocumentDescriptor(
        canonicalizeDashboardDocument(project.draftSchema) as DocumentDescriptor['schema'],
      ),
      invocation: requested.invocation,
    })
    const inputSha256 = hashExecutorPrepareInput(input)
    const issuedAt = Math.floor(now.getTime() / 1_000)
    const expiresAt = new Date((issuedAt + MAX_EXECUTOR_GRANT_LIFETIME_SECONDS) * 1_000)
    const grantJti = options.createGrantId?.() ?? randomUUID()
    const issued = await options.repository.issueAgentSpikeOperation(actorId, {
      projectId,
      taskId: input.taskId,
      stageId: input.stageId,
      executorId: input.executorId,
      operationId: input.operationId,
      grantJti,
      baseDraftVersion: input.baseDraftVersion,
      inputDigest: inputSha256,
      executorInput: input as unknown as Record<string, unknown>,
      compatibility: { ...input.compatibility },
      expiresAt,
      ...(skillTrace ? { skillTrace } : {}),
    })
    if (issued === 'integrity_conflict') {
      operation = await options.repository.getAgentSpikeOperationOutcome(actorId, requested.operationId)
      input = operation ? persistedIssueInput(operation, actorId, projectId, requested) : null
      if (!operation || !input) mapIssueResult(issued)
    } else {
      operation = mapIssueResult(issued)
    }
  }
  if (!operation || !input) {
    throw new ApiError(409, 'AGENT_OPERATION_INTEGRITY_CONFLICT', 'Agent operation issuance was inconsistent')
  }
  if (!agentSkillTraceMatches(operation.skillTrace ?? null, skillTrace)) {
    throw new ApiError(
      409,
      'AGENT_OPERATION_INTEGRITY_CONFLICT',
      'Issued operation does not match the requested Agent Skill trace',
    )
  }
  const persistedInput = persistedIssueInput(operation, actorId, projectId, requested)
  if (!persistedInput) {
    throw new ApiError(
      409,
      'AGENT_OPERATION_INTEGRITY_CONFLICT',
      'Issued operation does not match the requested executor authority',
    )
  }
  input = persistedInput
  return {
    operation,
    input,
    grant: mintOperationGrant(operation, input, grantSecret, now),
    recoveryGrant: mintOperationRecoveryGrant(operation, input, grantSecret),
  }
}

export async function restoreAgentSpikeOperationExecution(
  options: AgentSpikeRouteOptions,
  actorId: string,
  operationIdValue: string,
  dispatchAttempt?: ClaimedDispatchAttempt,
): Promise<IssuedAgentSpikeOperation> {
  const { grantSecret, expectedCompatibility } = executorConfiguration(options)
  const operationIdResult = operationIdSchema.safeParse(operationIdValue)
  if (!operationIdResult.success) throw new ApiError(404, 'AGENT_OPERATION_NOT_FOUND', 'Agent operation not found')
  const operation = await options.repository.getAgentSpikeOperationOutcome(actorId, operationIdResult.data)
  if (!operation) throw new ApiError(404, 'AGENT_OPERATION_NOT_FOUND', 'Agent operation not found')
  if (operation.actorId !== actorId || operation.operationId !== operationIdResult.data) {
    throw new ApiError(404, 'AGENT_OPERATION_NOT_FOUND', 'Agent operation not found')
  }
  if (operation.status === 'committed') {
    throw new ApiError(409, 'AGENT_OPERATION_ALREADY_COMMITTED', 'Agent operation is already committed')
  }
  if (operation.status !== 'issued' && operation.status !== 'prepared') {
    throw new ApiError(409, 'AGENT_OPERATION_FAILED', 'Agent operation is already in a failed terminal state')
  }

  const input = persistedExecutionInput(operation, actorId, operationIdResult.data)
  if (hashCompatibilityTuple(input.compatibility) !== hashCompatibilityTuple(expectedCompatibility)) {
    throw new ApiError(
      409,
      'AGENT_EXECUTOR_COMPATIBILITY_MISMATCH',
      'Persisted executor compatibility does not match the deployed artifact lock',
    )
  }
  const now = currentDate(options)
  if (!dispatchAttempt && Math.floor(operation.expiresAt.getTime() / 1_000) <= Math.floor(now.getTime() / 1_000)) {
    throw new ApiError(409, 'AGENT_OPERATION_EXPIRED', 'Agent operation mutation authority has expired')
  }

  return {
    operation,
    input,
    grant: mintOperationGrant(operation, input, grantSecret, now, dispatchAttempt),
    recoveryGrant: mintOperationRecoveryGrant(operation, input, grantSecret),
  }
}

export function createAgentSpikeProjectRoutes(options: AgentSpikeRouteOptions) {
  const routes = new Hono<{ Variables: AppVariables }>()

  routes.post('/:projectId/agent-spike/operations', async c => {
    const projectId = projectIdFrom(c)
    const requested = await readJson(c, issueOperationSchema)
    const actorId = c.get('actorId')
    const { operation, input, grant, recoveryGrant } = await issueAgentSpikeOperation(
      options,
      actorId,
      projectId,
      requested,
    )

    c.header('Cache-Control', 'private, no-store')
    return c.json(
      {
        operation: operationOutcome(operation),
        executor: {
          input,
          grant,
          recoveryGrant,
          expiresAt: operation.expiresAt,
        },
      },
      201,
    )
  })

  return routes
}

export function createAgentSpikeExecutorRoutes(options: AgentSpikeRouteOptions) {
  const routes = new Hono<{ Variables: AppVariables }>()

  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })

  routes.get('/operations/:operationId/input', async c => {
    const operationId = operationIdFrom(c)
    const { grant, authority } = verifyRouteGrant(c.req.header('Authorization'), operationId, 'input:read', options)
    const { input } = await loadBoundOperation(options, grant, authority)
    return c.json({ input })
  })

  routes.put('/operations/:operationId/prepared', async c => {
    const operationId = operationIdFrom(c)
    const { token, grant, authority } = verifyRouteGrant(
      c.req.header('Authorization'),
      operationId,
      'candidate:prepare',
      options,
    )
    const { operation, input } = await loadBoundOperation(options, grant, authority)
    try {
      authorizeExecutorPrepare(token, input, executorConfiguration(options).grantSecret, {
        now: currentDate(options),
      })
    } catch (error) {
      throw executorContractApiError(error, 'AGENT_GRANT_INVALID')
    }

    const submitted = await readJson(c, executorPreparedResultSchema)
    let prepared: ExecutorPreparedResult
    try {
      prepared = validatePreparedResult(input, submitted)
    } catch (error) {
      throw executorContractApiError(error, 'AGENT_PREPARED_RESULT_INVALID')
    }
    assertProjectBudget(prepared.candidateProject.schema)
    assertPreparedEvidence(prepared)

    const result = mapPreparedResult(
      await options.repository.prepareAgentSpikeOperation(
        grant.actorId,
        bindingFrom(operation),
        {
          ...(grant.dispatchAttempt ? { dispatchAttempt: grant.dispatchAttempt } : {}),
        },
        {
          candidateSchema: prepared.candidateProject.schema,
          hostReceipt: { ...prepared.semanticReceipt },
          evidence: { ...prepared.evidence },
        },
      ),
    )
    if (result.candidateDigest !== prepared.candidateProject.sha256) {
      throw new ApiError(
        409,
        'AGENT_OPERATION_INTEGRITY_CONFLICT',
        'Prepared candidate digest does not match the persisted operation',
      )
    }
    return c.json({ outcome: operationOutcome(result) })
  })

  routes.post('/operations/:operationId/commit', async c => {
    const operationId = operationIdFrom(c)
    const { grant, authority } = verifyRouteGrant(c.req.header('Authorization'), operationId, 'commit:request', options)
    const { operation } = await loadBoundOperation(options, grant, authority)
    const requested = await readJson(c, commitRequestSchema)
    if (!operation.candidateDigest) {
      throw new ApiError(409, 'AGENT_OPERATION_INVALID_STATE', 'Agent operation has no prepared candidate')
    }
    if (operation.candidateDigest !== requested.candidateSha256) {
      throw new ApiError(
        409,
        'AGENT_OPERATION_INTEGRITY_CONFLICT',
        'Commit candidate digest does not match the prepared operation',
      )
    }

    const result = mapCommitResult(
      await options.repository.commitAgentSpikeStage(grant.actorId, bindingFrom(operation), {
        ...(grant.dispatchAttempt ? { dispatchAttempt: grant.dispatchAttempt } : {}),
      }),
    )
    if (result.candidateDigest !== requested.candidateSha256) {
      throw new ApiError(
        409,
        'AGENT_OPERATION_INTEGRITY_CONFLICT',
        'Committed outcome does not match the requested candidate digest',
      )
    }
    return c.json({ outcome: operationOutcome(result) })
  })

  routes.get('/operations/:operationId/outcome', async c => {
    const operationId = operationIdFrom(c)
    const { grant, authority } = verifyRouteGrant(
      c.req.header('Authorization'),
      operationId,
      'outcome:read',
      options,
      'mutation-or-recovery',
    )
    const { operation } = await loadBoundOperation(options, grant, authority)
    return c.json({ outcome: operationOutcome(operation) })
  })

  return routes
}
