import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const EXECUTOR_CONTRACT_VERSION = 'easy-dashboard.executor.v1' as const
export const EXECUTOR_GRANT_ISSUER = 'easy-dashboard-hono' as const
export const EXECUTOR_GRANT_AUDIENCE = 'easy-dashboard-document-executor' as const
export const MAX_EXECUTOR_GRANT_LIFETIME_SECONDS = 5 * 60
export const MAX_EXECUTOR_RECOVERY_GRANT_LIFETIME_SECONDS = 24 * 60 * 60
export const EXECUTOR_GRANT_SCOPES = ['input:read', 'candidate:prepare', 'commit:request', 'outcome:read'] as const

const identifierSchema = z.string().trim().min(1).max(160)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const isoTimestampSchema = z.string().datetime({ offset: true })
const jsonObjectSchema = z.record(z.string(), z.json())

export const compatibilityTupleSchema = z
  .object({
    runtimeVersion: identifierSchema,
    runtimeSha256: sha256Schema,
    coreVersion: identifierSchema,
    coreSha256: sha256Schema,
    rendererVersion: identifierSchema,
    rendererSha256: sha256Schema,
    dashboardAgentHostVersion: identifierSchema,
    dashboardAgentHostSha256: sha256Schema,
    browserArtifactVersion: identifierSchema,
    browserArtifactSha256: sha256Schema,
    materialManifestVersion: identifierSchema,
    materialManifestSha256: sha256Schema,
  })
  .strict()

export const executorGrantPayloadSchema = z
  .object({
    contractVersion: z.literal(EXECUTOR_CONTRACT_VERSION),
    iss: z.literal(EXECUTOR_GRANT_ISSUER),
    aud: z.literal(EXECUTOR_GRANT_AUDIENCE),
    executorId: identifierSchema,
    jti: identifierSchema,
    operationId: identifierSchema,
    projectId: identifierSchema,
    actorId: identifierSchema,
    taskId: identifierSchema,
    stageId: identifierSchema,
    baseDraftVersion: z.number().int().nonnegative(),
    inputSha256: sha256Schema,
    compatibilitySha256: sha256Schema,
    dispatchAttempt: z
      .object({
        dispatchId: identifierSchema,
        workerId: identifierSchema,
        leaseGeneration: z.number().int().positive(),
      })
      .strict()
      .optional(),
    scopes: z.array(z.enum(EXECUTOR_GRANT_SCOPES)).min(1).max(EXECUTOR_GRANT_SCOPES.length),
    iat: z.number().int().nonnegative(),
    nbf: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict()

export const documentDescriptorSchema = z
  .object({
    schema: jsonObjectSchema,
    bytes: z.number().int().nonnegative(),
    sha256: sha256Schema,
  })
  .strict()

const relativePositionSchema = z.discriminatedUnion('place', [
  z.object({ place: z.literal('first') }).strict(),
  z.object({ place: z.literal('last') }).strict(),
  z
    .object({
      place: z.literal('before'),
      siblingId: identifierSchema,
    })
    .strict(),
  z
    .object({
      place: z.literal('after'),
      siblingId: identifierSchema,
    })
    .strict(),
])

const rectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict()

export const screenOperationSchema = z.discriminatedUnion('type', [
  z
    .object({
      opId: identifierSchema,
      type: z.literal('insert'),
      parentId: identifierSchema,
      componentName: identifierSchema,
      position: relativePositionSchema.optional(),
      fields: z.record(z.string(), z.json()).optional(),
    })
    .strict(),
  z
    .object({
      opId: identifierSchema,
      type: z.literal('move'),
      nodeId: identifierSchema,
      parentId: identifierSchema,
      position: relativePositionSchema.optional(),
    })
    .strict(),
  z
    .object({
      opId: identifierSchema,
      type: z.literal('resize'),
      nodeId: identifierSchema,
      rect: rectSchema,
    })
    .strict(),
  z
    .object({
      opId: identifierSchema,
      type: z.literal('set'),
      nodeId: identifierSchema,
      fieldId: identifierSchema,
      value: z.json(),
    })
    .strict(),
  z
    .object({
      opId: identifierSchema,
      type: z.literal('unset'),
      nodeId: identifierSchema,
      fieldId: identifierSchema,
    })
    .strict(),
  z
    .object({
      opId: identifierSchema,
      type: z.literal('reorder'),
      nodeId: identifierSchema,
      position: relativePositionSchema,
    })
    .strict(),
  z
    .object({
      opId: identifierSchema,
      type: z.literal('remove'),
      nodeId: identifierSchema,
    })
    .strict(),
])

export const screenApplyChangeSetInvocationSchema = z
  .object({
    sessionId: identifierSchema,
    stepId: identifierSchema,
    callId: identifierSchema,
    capability: z.literal('screen.applyChangeSet'),
    arguments: z
      .object({
        schemaVersion: z.literal(1),
        documentId: identifierSchema,
        operations: z.array(screenOperationSchema).min(1).max(1_000),
      })
      .strict(),
  })
  .strict()

export const executorPrepareInputSchema = z
  .object({
    contractVersion: z.literal(EXECUTOR_CONTRACT_VERSION),
    executorId: identifierSchema,
    operationId: identifierSchema,
    projectId: identifierSchema,
    actorId: identifierSchema,
    taskId: identifierSchema,
    stageId: identifierSchema,
    baseDraftVersion: z.number().int().nonnegative(),
    compatibility: compatibilityTupleSchema,
    baseProject: documentDescriptorSchema,
    invocation: screenApplyChangeSetInvocationSchema,
  })
  .strict()

const semanticReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: identifierSchema,
    branchId: z.literal('draft'),
    callId: identifierSchema,
    status: z.literal('applied'),
    revision: identifierSchema.optional(),
    witness: jsonObjectSchema.optional(),
  })
  .strict()

const consoleEvidenceSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string().max(16_384),
    timestampMs: z.number().nonnegative(),
  })
  .strict()

const resourceErrorSchema = z
  .object({
    resourceUrlSha256: sha256Schema,
    kind: z.enum(['network', 'cors', 'decode', 'timeout', 'blocked']),
    message: z.string().max(4_096),
  })
  .strict()

const renderViewportSchema = z
  .object({
    width: z.number().int().positive().max(8_192),
    height: z.number().int().positive().max(8_192),
  })
  .strict()
  .refine(viewport => viewport.width * viewport.height <= 33_554_432, 'Render viewport exceeds pixel budget')

const renderLayoutEvidenceSchema = z
  .object({
    status: z.enum(['passed', 'failed']),
    targetViewport: renderViewportSchema,
    browserViewport: renderViewportSchema,
    simulatorViewport: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().positive().max(8_192),
        height: z.number().positive().max(8_192),
      })
      .strict(),
    viewportMatchesTarget: z.boolean(),
    componentElementCount: z.number().int().nonnegative().max(100_000),
    visibleElementCount: z.number().int().nonnegative().max(100_000),
    hiddenElementCount: z.number().int().nonnegative().max(100_000),
    zeroAreaElementCount: z.number().int().nonnegative().max(100_000),
    overflowingElementCount: z.number().int().nonnegative().max(100_000),
    clippedElementCount: z.number().int().nonnegative().max(100_000),
    documentOverflow: z.object({ horizontal: z.boolean(), vertical: z.boolean() }).strict(),
  })
  .strict()

const renderEvidenceSchema = z
  .object({
    status: z.enum(['rendered', 'rendered_with_errors']),
    rendererReady: z.literal(true),
    viewport: renderViewportSchema,
    durationMs: z.number().nonnegative(),
    screenshotSha256: sha256Schema.optional(),
    layout: renderLayoutEvidenceSchema.optional(),
    resourceErrors: z.array(resourceErrorSchema).max(1_000),
  })
  .strict()

const materialEvidenceSchema = z
  .object({
    manifestVersion: identifierSchema,
    loaded: z
      .array(
        z
          .object({
            materialId: identifierSchema,
            version: identifierSchema,
          })
          .strict(),
      )
      .max(10_000),
    missing: z.array(identifierSchema).max(10_000),
  })
  .strict()

const requestEvidenceSchema = z
  .object({
    requestId: identifierSchema,
    startedAt: isoTimestampSchema,
    completedAt: isoTimestampSchema,
  })
  .strict()

const consoleErrorEvidenceSchema = z
  .object({
    message: z.string().min(1).max(16_384),
    stackSha256: sha256Schema.optional(),
    timestampMs: z.number().nonnegative(),
  })
  .strict()

const requestFailureEvidenceSchema = z
  .object({
    requestUrlSha256: sha256Schema,
    method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
    status: z.number().int().min(100).max(599).optional(),
    errorCode: identifierSchema,
  })
  .strict()

const timingEvidenceSchema = z
  .object({
    totalMs: z.number().nonnegative(),
    hostStartupMs: z.number().nonnegative(),
    applyChangeSetMs: z.number().nonnegative(),
    exportMs: z.number().nonnegative(),
  })
  .strict()

export const executorPreparedResultSchema = z
  .object({
    contractVersion: z.literal(EXECUTOR_CONTRACT_VERSION),
    executorId: identifierSchema,
    operationId: identifierSchema,
    projectId: identifierSchema,
    actorId: identifierSchema,
    taskId: identifierSchema,
    stageId: identifierSchema,
    baseDraftVersion: z.number().int().nonnegative(),
    inputSha256: sha256Schema,
    compatibilitySha256: sha256Schema,
    compatibility: compatibilityTupleSchema,
    candidateProject: documentDescriptorSchema,
    semanticReceipt: semanticReceiptSchema,
    evidence: z
      .object({
        console: z.array(consoleEvidenceSchema).max(10_000),
        consoleErrors: z.array(consoleErrorEvidenceSchema).max(10_000),
        requestFailures: z.array(requestFailureEvidenceSchema).max(10_000),
        render: renderEvidenceSchema,
        materials: materialEvidenceSchema,
        request: requestEvidenceSchema,
        timing: timingEvidenceSchema,
      })
      .strict(),
    preRevision: identifierSchema,
    postRevision: identifierSchema,
    preparedAt: isoTimestampSchema,
  })
  .strict()

export const durableCommitReceiptSchema = z
  .object({
    contractVersion: z.literal(EXECUTOR_CONTRACT_VERSION),
    receiptVersion: z.literal('easy-dashboard.cas-commit-receipt.v1'),
    receiptId: identifierSchema,
    operationId: identifierSchema,
    projectId: identifierSchema,
    actorId: identifierSchema,
    taskId: identifierSchema,
    stageId: identifierSchema,
    baseDraftVersion: z.number().int().nonnegative(),
    committedDraftVersion: z.number().int().positive(),
    inputSha256: sha256Schema,
    compatibilitySha256: sha256Schema,
    candidateSha256: sha256Schema,
    candidateBytes: z.number().int().nonnegative(),
    committedAt: isoTimestampSchema,
    repositoryWitness: z
      .object({
        kind: z.literal('hono.repository.cas'),
        transactionId: identifierSchema,
      })
      .strict(),
  })
  .strict()

export type CompatibilityTuple = z.infer<typeof compatibilityTupleSchema>
export type ExecutorGrantScope = (typeof EXECUTOR_GRANT_SCOPES)[number]
export type ExecutorGrantPayload = z.infer<typeof executorGrantPayloadSchema>
export type DocumentDescriptor = z.infer<typeof documentDescriptorSchema>
export type ExecutorPrepareInput = z.infer<typeof executorPrepareInputSchema>
export type ExecutorPreparedResult = z.infer<typeof executorPreparedResultSchema>
export type ScreenApplyChangeSetInvocation = z.infer<typeof screenApplyChangeSetInvocationSchema>
export type DurableCommitReceipt = z.infer<typeof durableCommitReceiptSchema>

export type ExecutorContractErrorCode =
  | 'INVALID_CONTRACT'
  | 'INVALID_GRANT_LIFETIME'
  | 'INVALID_GRANT_SECRET'
  | 'INVALID_GRANT_TOKEN'
  | 'INVALID_GRANT_SIGNATURE'
  | 'GRANT_EXPIRED'
  | 'GRANT_NOT_YET_VALID'
  | 'INSUFFICIENT_GRANT_SCOPE'
  | 'INVALID_RECOVERY_GRANT_SCOPE'
  | 'DATABASE_CREDENTIAL_FORBIDDEN'
  | 'DOCUMENT_DESCRIPTOR_MISMATCH'
  | 'AUTHORITY_MISMATCH'
  | 'RESULT_MISMATCH'

export class ExecutorContractError extends Error {
  constructor(
    public readonly code: ExecutorContractErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ExecutorContractError'
  }
}

const forbiddenDatabaseCredentialKeys = new Set([
  'connectionstring',
  'databasecredentials',
  'databasecredential',
  'databasehost',
  'databasename',
  'databasepassword',
  'databaseport',
  'databaseuri',
  'databaseurl',
  'databaseuser',
  'databaseusername',
  'dbcredential',
  'dbcredentials',
  'dbhost',
  'dbname',
  'dbpassword',
  'dbport',
  'dburl',
  'dbuser',
  'dbusername',
  'pgconnectionstring',
  'pgdatabase',
  'pghost',
  'pgpassword',
  'pgport',
  'pguser',
  'postgrespassword',
  'postgresuser',
  'postgresusername',
  'postgresqlurl',
  'postgresurl',
  'servicerolekey',
  'supabaseservicerolekey',
])

function normalizedKey(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}

function assertNoDatabaseCredentials(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoDatabaseCredentials(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenDatabaseCredentialKeys.has(normalizedKey(key))) {
      throw new ExecutorContractError(
        'DATABASE_CREDENTIAL_FORBIDDEN',
        `Database credential field is forbidden at ${path}.${key}`,
      )
    }
    assertNoDatabaseCredentials(child, `${path}.${key}`)
  }
}

function parseStrict<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ExecutorContractError('INVALID_CONTRACT', `${label} does not match the strict contract`, result.error)
  }
  assertNoDatabaseCredentials(result.data)
  return result.data
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export function hashCompatibilityTuple(value: CompatibilityTuple): string {
  const compatibility = parseStrict(compatibilityTupleSchema, value, 'Compatibility tuple')
  return hashJson(compatibility)
}

export function createDocumentDescriptor(schema: DocumentDescriptor['schema']): DocumentDescriptor {
  const parsedSchema = parseStrict(jsonObjectSchema, schema, 'Project document')
  const serialized = canonicalJson(parsedSchema)
  return {
    schema: parsedSchema,
    bytes: Buffer.byteLength(serialized, 'utf8'),
    sha256: createHash('sha256').update(serialized, 'utf8').digest('hex'),
  }
}

function assertDocumentDescriptor(descriptor: DocumentDescriptor): void {
  const actual = createDocumentDescriptor(descriptor.schema)
  if (actual.bytes !== descriptor.bytes || actual.sha256 !== descriptor.sha256) {
    throw new ExecutorContractError(
      'DOCUMENT_DESCRIPTOR_MISMATCH',
      'Document byte length or SHA-256 does not match its schema',
    )
  }
}

function parseGrantPayload(value: unknown): ExecutorGrantPayload {
  const payload = parseStrict(executorGrantPayloadSchema, value, 'Executor grant payload')
  const isRecoveryGrant = payload.scopes.length === 1 && payload.scopes[0] === 'outcome:read'
  const maximumLifetime = isRecoveryGrant
    ? MAX_EXECUTOR_RECOVERY_GRANT_LIFETIME_SECONDS
    : MAX_EXECUTOR_GRANT_LIFETIME_SECONDS
  if (payload.nbf < payload.iat || payload.exp <= payload.nbf || payload.exp - payload.iat > maximumLifetime) {
    throw new ExecutorContractError(
      'INVALID_GRANT_LIFETIME',
      `Executor grant must live for at most ${maximumLifetime} seconds`,
    )
  }
  if (new Set(payload.scopes).size !== payload.scopes.length) {
    throw new ExecutorContractError('INVALID_CONTRACT', 'Executor grant scopes must be unique')
  }
  if (isRecoveryGrant && payload.dispatchAttempt) {
    throw new ExecutorContractError('INVALID_CONTRACT', 'Executor recovery grants cannot carry dispatch authority')
  }
  return payload
}

function secretBytes(secret: string | Uint8Array): Buffer {
  const bytes = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret)
  if (bytes.byteLength < 32) {
    throw new ExecutorContractError(
      'INVALID_GRANT_SECRET',
      'Executor grant HMAC secrets must contain at least 32 bytes',
    )
  }
  return bytes
}

function sign(encodedPayload: string, secret: string | Uint8Array): Buffer {
  return createHmac('sha256', secretBytes(secret)).update(`edxg1.${encodedPayload}`).digest()
}

export function mintExecutorGrant(payload: ExecutorGrantPayload, secret: string | Uint8Array): string {
  const parsed = parseGrantPayload(payload)
  const encodedPayload = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url')
  const signature = sign(encodedPayload, secret).toString('base64url')
  return `edxg1.${encodedPayload}.${signature}`
}

export function verifyExecutorGrant(
  token: string,
  secret: string | Uint8Array,
  options: { now?: number | Date } = {},
): ExecutorGrantPayload {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'edxg1' || !parts[1] || !parts[2]) {
    throw new ExecutorContractError('INVALID_GRANT_TOKEN', 'Executor grant token is malformed')
  }

  const encodedPayload = parts[1]
  const receivedSignature = Buffer.from(parts[2], 'base64url')
  const expectedSignature = sign(encodedPayload, secret)
  if (
    receivedSignature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    throw new ExecutorContractError('INVALID_GRANT_SIGNATURE', 'Executor grant signature is invalid')
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as unknown
  } catch (error) {
    throw new ExecutorContractError('INVALID_GRANT_TOKEN', 'Executor grant payload is not valid JSON', error)
  }
  const payload = parseGrantPayload(decoded)
  const nowValue = options.now instanceof Date ? Math.floor(options.now.getTime() / 1000) : options.now
  const now = nowValue ?? Math.floor(Date.now() / 1000)

  if (now >= payload.exp) {
    throw new ExecutorContractError('GRANT_EXPIRED', 'Executor grant has expired')
  }
  if (now < payload.nbf) {
    throw new ExecutorContractError('GRANT_NOT_YET_VALID', 'Executor grant is not valid yet')
  }
  return payload
}

export function requireExecutorGrantScope(
  grant: ExecutorGrantPayload,
  requiredScope: ExecutorGrantScope,
): ExecutorGrantPayload {
  if (!grant.scopes.includes(requiredScope)) {
    throw new ExecutorContractError(
      'INSUFFICIENT_GRANT_SCOPE',
      `Executor grant does not include required scope ${requiredScope}`,
    )
  }
  return grant
}

export function verifyExecutorGrantForScope(
  token: string,
  secret: string | Uint8Array,
  requiredScope: ExecutorGrantScope,
  options: { now?: number | Date } = {},
): ExecutorGrantPayload {
  return requireExecutorGrantScope(verifyExecutorGrant(token, secret, options), requiredScope)
}

export function verifyExecutorRecoveryGrant(
  token: string,
  secret: string | Uint8Array,
  options: { now?: number | Date } = {},
): ExecutorGrantPayload {
  const grant = verifyExecutorGrant(token, secret, options)
  if (grant.scopes.length !== 1 || grant.scopes[0] !== 'outcome:read') {
    throw new ExecutorContractError(
      'INVALID_RECOVERY_GRANT_SCOPE',
      'Executor recovery grant must contain exactly the outcome:read scope',
    )
  }
  return grant
}

export function parseExecutorPrepareInput(value: unknown): ExecutorPrepareInput {
  const input = parseStrict(executorPrepareInputSchema, value, 'Executor prepare input')
  assertDocumentDescriptor(input.baseProject)
  const operationIds = input.invocation.arguments.operations.map(operation => operation.opId)
  if (new Set(operationIds).size !== operationIds.length) {
    throw new ExecutorContractError('INVALID_CONTRACT', 'screen.applyChangeSet operation IDs must be unique')
  }
  return input
}

export function hashExecutorPrepareInput(value: ExecutorPrepareInput): string {
  return hashJson(parseExecutorPrepareInput(value))
}

function authorityFieldsMatch(grant: ExecutorGrantPayload, input: ExecutorPrepareInput): boolean {
  return (
    grant.executorId === input.executorId &&
    grant.operationId === input.operationId &&
    grant.projectId === input.projectId &&
    grant.actorId === input.actorId &&
    grant.taskId === input.taskId &&
    grant.stageId === input.stageId &&
    grant.baseDraftVersion === input.baseDraftVersion &&
    grant.inputSha256 === hashExecutorPrepareInput(input) &&
    grant.compatibilitySha256 === hashCompatibilityTuple(input.compatibility)
  )
}

function expectedMissingMaterialIds(schema: unknown, loadedMaterialIds: readonly string[]): string[] {
  const loaded = new Set(loadedMaterialIds)
  const required = new Set<string>()
  const visited = new Set<Record<string, unknown>>()
  const visitNode = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const node = value as Record<string, unknown>
    if (visited.has(node)) return
    visited.add(node)
    if (typeof node.componentName === 'string' && node.componentName.trim()) required.add(node.componentName.trim())
    if (Array.isArray(node.children)) node.children.forEach(visitNode)
  }
  const findTrees = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(findTrees)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (visited.has(record)) return
    if (Array.isArray(record.componentsTree)) record.componentsTree.forEach(visitNode)
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'componentsTree') findTrees(child)
    }
  }
  findTrees(schema)
  return [...required].filter(componentName => !loaded.has(componentName)).sort()
}

export function authorizeExecutorPrepare(
  grantToken: string,
  value: unknown,
  secret: string | Uint8Array,
  options: { now?: number | Date } = {},
): { input: ExecutorPrepareInput; grant: ExecutorGrantPayload } {
  const input = parseExecutorPrepareInput(value)
  const grant = verifyExecutorGrantForScope(grantToken, secret, 'candidate:prepare', options)
  if (!authorityFieldsMatch(grant, input)) {
    throw new ExecutorContractError('AUTHORITY_MISMATCH', 'Executor grant authority does not match the prepare input')
  }
  return { input, grant }
}

export function parseExecutorPreparedResult(value: unknown): ExecutorPreparedResult {
  const result = parseStrict(executorPreparedResultSchema, value, 'Executor prepared result')
  assertDocumentDescriptor(result.candidateProject)
  const expectedMissingMaterials = expectedMissingMaterialIds(
    result.candidateProject.schema,
    result.evidence.materials.loaded.map(material => material.materialId),
  )
  const internallyConsistent =
    result.compatibilitySha256 === hashCompatibilityTuple(result.compatibility) &&
    result.preRevision !== result.postRevision &&
    result.semanticReceipt.revision === result.postRevision &&
    result.evidence.materials.manifestVersion === result.compatibility.materialManifestVersion &&
    JSON.stringify(result.evidence.materials.missing) === JSON.stringify(expectedMissingMaterials) &&
    Date.parse(result.evidence.request.completedAt) >= Date.parse(result.evidence.request.startedAt)
  if (!internallyConsistent) {
    throw new ExecutorContractError(
      'RESULT_MISMATCH',
      'Prepared result contains inconsistent compatibility, revisions, receipt, material, or request evidence',
    )
  }
  return result
}

export function parseDurableCommitReceipt(value: unknown): DurableCommitReceipt {
  const receipt = parseStrict(durableCommitReceiptSchema, value, 'Durable commit receipt')
  if (receipt.committedDraftVersion !== receipt.baseDraftVersion + 1) {
    throw new ExecutorContractError('RESULT_MISMATCH', 'Durable commit receipt revisions are inconsistent')
  }
  return receipt
}

function sameCompatibility(left: CompatibilityTuple, right: CompatibilityTuple): boolean {
  return hashCompatibilityTuple(left) === hashCompatibilityTuple(right)
}

export function validatePreparedResult(prepareValue: unknown, resultValue: unknown): ExecutorPreparedResult {
  const input = parseExecutorPrepareInput(prepareValue)
  const result = parseExecutorPreparedResult(resultValue)
  const commonFieldsMatch =
    result.executorId === input.executorId &&
    result.operationId === input.operationId &&
    result.projectId === input.projectId &&
    result.actorId === input.actorId &&
    result.taskId === input.taskId &&
    result.stageId === input.stageId &&
    result.baseDraftVersion === input.baseDraftVersion
  const resultEvidenceMatches =
    result.inputSha256 === hashExecutorPrepareInput(input) &&
    result.compatibilitySha256 === hashCompatibilityTuple(input.compatibility) &&
    sameCompatibility(result.compatibility, input.compatibility) &&
    result.semanticReceipt.projectId === input.projectId &&
    result.semanticReceipt.branchId === 'draft' &&
    result.semanticReceipt.callId === input.invocation.callId &&
    result.evidence.materials.manifestVersion === input.compatibility.materialManifestVersion

  if (!commonFieldsMatch || !resultEvidenceMatches) {
    throw new ExecutorContractError(
      'RESULT_MISMATCH',
      'Prepared result authority, base version, compatibility, or evidence does not match the prepare input',
    )
  }
  return result
}
