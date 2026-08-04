import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, max, ne, or, sql } from 'drizzle-orm'
import { readAgentUserPreferenceMemory } from '../agent/agent-user-preferences.js'
import { agentRunInputDigest, estimateAgentProviderInputTokens } from '../agent/change-set-model.js'
import { derivePublicCost } from '../agent/cost-accuracy.js'
import { safeAgentUndo } from '../agent/safe-agent-undo.js'
import type { AppEnv } from '../env.js'
import type {
  AgentMutationAuthority,
  AgentProjectContextRecord,
  AgentProjectStartRecord,
  AgentProviderInputSnapshot,
  AgentRunCostRecord,
  AgentRunDispatchRecord,
  AgentRunDispatchState,
  AgentSpikeOperationBinding,
  AgentSpikeOperationRecord,
  AgentSpikeOperationStatus,
  AgentWorkspaceRecord,
  DurableAgentTurnRecord,
  DurableProviderAttemptRecord,
  PublicProject,
  Repository,
} from '../types.js'
import type { ProjectSchema } from '../validation.js'
import {
  agentSpikeCandidateDigest,
  agentSpikeIssueDigest,
  agentSpikePreparedDigest,
  canonicalJsonSha256,
  compareAgentSpikeDigest,
} from './agent-stage-commit.js'
import { createDatabase } from './client.js'
import {
  agentAssets,
  agentProjectContexts,
  agentProviderAttempts,
  agentRunCosts,
  agentRunDispatches,
  agentSpikeOperations,
  agentWorkspaces,
  projectFavorites,
  projectMembers,
  projectPreviewRuns,
  projectPublications,
  projectPublishApprovals,
  projectPublishSnapshots,
  projectReleases,
  projectRevisions,
  projectThumbnailArtifacts,
  projects,
  spaceMembers,
  spaces,
  templates,
  userSettings,
} from './schema.js'

const THUMBNAIL_BUCKET = 'easy-dashboard-thumbnails'
const AGENT_ASSET_BUCKET = 'easy-dashboard-agent-assets'
const MAX_AGENT_ASSET_BYTES = 20 * 1024 * 1024
const MAX_AGENT_ASSET_COUNT = 200
const AGENT_ASSET_UPLOAD_STALE_HOURS = 3
const agentAssetPublicSelection = {
  id: agentAssets.id,
  projectId: agentAssets.projectId,
  conversationId: agentAssets.conversationId,
  originalName: agentAssets.originalName,
  contentType: agentAssets.contentType,
  size: agentAssets.size,
  sha256: agentAssets.sha256,
  status: agentAssets.status,
  extractedText: agentAssets.extractedText,
  storagePath: agentAssets.storagePath,
  createdAt: agentAssets.createdAt,
  updatedAt: agentAssets.updatedAt,
}
const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024
const THUMBNAIL_UPLOAD_EXPIRES_MS = 2 * 60 * 60 * 1000
const THUMBNAIL_UPLOAD_EXPIRY_SAFETY_MS = 60 * 1000
const THUMBNAIL_UPLOAD_STAGING_EXPIRES_MS = 24 * 60 * 60 * 1000
const THUMBNAIL_CLEANUP_RETRY_MS = 5 * 60 * 1000

function cleanAgentPreviewEvidence(evidence: Record<string, unknown> | null): boolean {
  const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  const render = record(evidence?.render)
  const materials = record(evidence?.materials)
  return Boolean(
    evidence &&
      Array.isArray(evidence.consoleErrors) &&
      evidence.consoleErrors.length === 0 &&
      Array.isArray(evidence.requestFailures) &&
      evidence.requestFailures.length === 0 &&
      render?.status === 'rendered' &&
      typeof render.screenshotSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(render.screenshotSha256) &&
      Array.isArray(render.resourceErrors) &&
      render.resourceErrors.length === 0 &&
      Array.isArray(materials?.missing) &&
      materials.missing.length === 0,
  )
}

function reconciledDispatchState(
  operationStatus: AgentSpikeOperationStatus | null,
): Extract<AgentRunDispatchState, 'succeeded' | 'failed' | 'indeterminate'> | null {
  if (operationStatus === 'issued' || operationStatus === 'prepared') return null
  if (operationStatus === 'committed') return 'succeeded'
  if (operationStatus === 'rejected_stale' || operationStatus === 'failed_not_applied') return 'failed'
  return 'indeterminate'
}

class ThumbnailConflictRollback extends Error {
  override readonly name = 'ThumbnailConflictRollback'
}

class AgentUndoConflictRollback extends Error {
  override readonly name = 'AgentUndoConflictRollback'
}

export function signedThumbnailUploadCleanupExpiry(token: string, signedAt = Date.now()): Date {
  const documentedExpiry = signedAt + THUMBNAIL_UPLOAD_EXPIRES_MS
  let tokenExpiry = 0
  try {
    const payload = token.split('.')[1]
    if (payload) {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
      if (typeof decoded.exp === 'number' && Number.isFinite(decoded.exp)) {
        tokenExpiry = decoded.exp * 1000
      }
    }
  } catch {
    // Supabase currently returns a JWT, but the documented two-hour lifetime
    // remains the conservative fallback if its token representation changes.
  }
  return new Date(Math.max(documentedExpiry, tokenExpiry) + THUMBNAIL_UPLOAD_EXPIRY_SAFETY_MS)
}

export function thumbnailRequestedVersionCase(nextDraftVersion: number) {
  return sql<number>`case
    when ${projects.thumbnailMode} = 'auto' then cast(${nextDraftVersion} as integer)
    else null
  end`
}

function projectMetadata(schema: ProjectSchema): {
  pageCount: number
  canvasWidth: number
  canvasHeight: number
  startPageId: string | null
} {
  const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  const envelope = record(schema)
  const editorSchema = record(envelope?.editorSchema) ?? envelope
  const presentation = record(envelope?.presentation)
  const pages = Array.isArray(editorSchema?.componentsTree) ? editorSchema.componentsTree : []
  const requestedStartPageId =
    typeof presentation?.startPageId === 'string' && presentation.startPageId ? presentation.startPageId : null
  const pageId = (page: unknown): string | null => {
    const pageRecord = record(page)
    const meta = record(pageRecord?.meta)
    const easyDashboard = record(meta?.easyDashboard)
    for (const candidate of [easyDashboard?.pageId, pageRecord?.docId, pageRecord?.id]) {
      if (typeof candidate === 'string' && candidate) return candidate
    }
    return null
  }
  const startPage = pages.find(page => pageId(page) === requestedStartPageId) ?? pages[0]
  const startPageRecord = record(startPage)
  const dashboard = record(startPageRecord?.$dashboard)
  const rect = record(dashboard?.rect)
  return {
    pageCount: Math.max(1, pages.length),
    canvasWidth: typeof rect?.width === 'number' && rect.width > 0 ? Math.round(rect.width) : 1920,
    canvasHeight: typeof rect?.height === 'number' && rect.height > 0 ? Math.round(rect.height) : 1080,
    startPageId: requestedStartPageId ?? pageId(startPage),
  }
}

function toAgentProjectContextRecord(row: typeof agentProjectContexts.$inferSelect): AgentProjectContextRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    content: row.content,
    status: 'confirmed',
    revision: row.revision,
    history: row.history,
    ...(row.sourceTaskId ? { sourceTaskId: row.sourceTaskId } : {}),
    ...(row.provenance ? { provenance: row.provenance } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    confirmedAt: row.confirmedAt,
  }
}

function slugify(value: string, id: string): string {
  const base = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 54)
  return `${base || 'dashboard'}-${id.slice(0, 8)}`
}

function aggregateAgentRunCostRows(rows: readonly AgentRunCostRecord[]): AgentRunCostRecord | null {
  const latest = rows[0]
  if (!latest) return null
  const chargedRows = rows.filter(row => row.state !== 'released')
  if (chargedRows.length === 0) {
    return {
      ...latest,
      reservedMicros: 0,
      settledMicros: 0,
      minimumMicros: null,
      maximumMicros: null,
      promptTokens: null,
      completionTokens: null,
      createdAt: rows.reduce(
        (earliest, row) => (row.createdAt < earliest ? row.createdAt : earliest),
        latest.createdAt,
      ),
      updatedAt: rows.reduce((newest, row) => (row.updatedAt > newest ? row.updatedAt : newest), latest.updatedAt),
    }
  }
  const sumNullable = (select: (row: AgentRunCostRecord) => number | null): number | null => {
    const values = chargedRows.flatMap(row => {
      const value = select(row)
      return value === null ? [] : [value]
    })
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0)
  }
  const state: AgentRunCostRecord['state'] = chargedRows.some(row => row.state === 'reserved') ? 'reserved' : 'settled'
  const accuracy = chargedRows.some(row => row.accuracy === 'billing_indeterminate')
    ? 'billing_indeterminate'
    : chargedRows.some(row => row.accuracy === 'estimated')
      ? 'estimated'
      : chargedRows.every(row => row.accuracy === 'actual')
        ? 'actual'
        : null
  return {
    ...latest,
    state,
    accuracy,
    reservedMicros: chargedRows.reduce((sum, row) => sum + row.reservedMicros, 0),
    settledMicros: chargedRows.reduce((sum, row) => sum + row.settledMicros, 0),
    minimumMicros: chargedRows.reduce(
      (sum, row) => sum + (row.minimumMicros ?? (row.state === 'settled' ? row.settledMicros : 0)),
      0,
    ),
    maximumMicros: chargedRows.reduce(
      (sum, row) => sum + (row.maximumMicros ?? (row.state === 'reserved' ? row.reservedMicros : row.settledMicros)),
      0,
    ),
    promptTokens: sumNullable(row => row.promptTokens),
    completionTokens: sumNullable(row => row.completionTokens),
    createdAt: rows.reduce((earliest, row) => (row.createdAt < earliest ? row.createdAt : earliest), latest.createdAt),
    updatedAt: rows.reduce((newest, row) => (row.updatedAt > newest ? row.updatedAt : newest), latest.updatedAt),
  }
}

function durableProviderAttempt(
  row: typeof agentProviderAttempts.$inferSelect,
  idempotencyMode: 'unsupported' | 'stable',
): DurableProviderAttemptRecord {
  return {
    id: row.id,
    state: row.state,
    providerRequestKey: row.providerRequestKey,
    requestBodyDigest: row.requestBodyDigest,
    idempotencyMode,
  }
}

function durableTurnFromDispatch(row: typeof agentRunDispatches.$inferSelect): DurableAgentTurnRecord | null {
  const snapshot = row.inputSnapshot
  const providerInputSnapshot = durableProviderInputSnapshot(snapshot?.providerInputSnapshot)
  if (
    !row.turnId ||
    !row.inputDigest ||
    !row.frozenProvider ||
    !row.frozenModel ||
    !row.frozenProfile ||
    !row.billingScope ||
    !row.payerId ||
    row.taskLimitMicros === null ||
    row.projectLimitMicros === null ||
    !row.providerIdempotency ||
    !snapshot ||
    typeof snapshot.prompt !== 'string' ||
    typeof snapshot.endpoint !== 'string' ||
    typeof snapshot.reservedMicros !== 'number' ||
    typeof snapshot.projectDraftVersion !== 'number' ||
    typeof snapshot.maximumRateMicrosPerToken !== 'number' ||
    snapshot.maximumRateMicrosPerToken <= 0 ||
    !providerInputSnapshot ||
    !Array.isArray(snapshot.attachmentIds) ||
    !snapshot.attachmentIds.every(value => typeof value === 'string') ||
    !Array.isArray(snapshot.projectContext)
  ) {
    return null
  }
  const projectContext: DurableAgentTurnRecord['projectContext'] = snapshot.projectContext.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const item = value as Record<string, unknown>
    if (
      typeof item.title !== 'string' ||
      typeof item.content !== 'string' ||
      (item.status !== 'pending' && item.status !== 'confirmed')
    )
      return []
    return [{ title: item.title, content: item.content, status: item.status }]
  })
  if (projectContext.length !== snapshot.projectContext.length) return null
  return {
    actorId: row.actorId,
    projectId: row.projectId,
    conversationId: row.conversationId,
    taskId: row.taskId,
    turnId: row.turnId,
    operationId: row.operationId,
    inputDigest: row.inputDigest,
    prompt: snapshot.prompt,
    attachmentIds: [...snapshot.attachmentIds],
    projectContext,
    provider: row.frozenProvider,
    model: row.frozenModel,
    profileId: row.frozenProfile,
    endpoint: snapshot.endpoint,
    billingScope: row.billingScope,
    payerId: row.payerId,
    taskLimitMicros: row.taskLimitMicros,
    projectMonthLimitMicros: row.projectLimitMicros,
    projectDraftVersion: snapshot.projectDraftVersion,
    reservedMicros: snapshot.reservedMicros,
    maximumRateMicrosPerToken: snapshot.maximumRateMicrosPerToken,
    providerInputSnapshot,
    idempotencyMode: row.providerIdempotency,
    providerRequestKey: typeof snapshot.providerRequestKey === 'string' ? snapshot.providerRequestKey : null,
  }
}

function durableProviderInputSnapshot(value: unknown): AgentProviderInputSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Record<string, unknown>
  const trace = snapshot.trace
  const traceRecord =
    trace && typeof trace === 'object' && !Array.isArray(trace) ? (trace as Record<string, unknown>) : null
  const skills = traceRecord?.skills
  if (
    typeof snapshot.systemPrompt !== 'string' ||
    typeof snapshot.userText !== 'string' ||
    !traceRecord ||
    typeof traceRecord.promptBundleId !== 'string' ||
    typeof traceRecord.promptBundleVersion !== 'string' ||
    typeof traceRecord.promptBundleHash !== 'string' ||
    !Array.isArray(skills) ||
    !skills.every(skill => typeof skill === 'string') ||
    !Array.isArray(snapshot.images)
  ) {
    return null
  }
  const images = snapshot.images.flatMap(image => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) return []
    const record = image as Record<string, unknown>
    return typeof record.assetId === 'string' && typeof record.sha256 === 'string'
      ? [{ assetId: record.assetId, sha256: record.sha256 }]
      : []
  })
  if (images.length !== snapshot.images.length) return null
  return {
    systemPrompt: snapshot.systemPrompt,
    userText: snapshot.userText,
    trace: {
      promptBundleId: traceRecord.promptBundleId,
      promptBundleVersion: traceRecord.promptBundleVersion,
      promptBundleHash: traceRecord.promptBundleHash,
      skills: [...skills],
    },
    images,
  }
}

export function createPgRepository(env: AppEnv): Repository {
  const { db, pool } = createDatabase(env)
  const withActor = <T>(
    actorId: string,
    run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  ) =>
    db.transaction(async tx => {
      await tx.execute(sql`select set_config('app.actor_id', ${actorId}, true)`)
      return run(tx)
    })

  const lockUserSettings = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], actorId: string) =>
    tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:user-settings`}, 0))`)

  const ensurePersonalSpaceWithTx = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
  ): Promise<string> => {
    const [created] = await tx
      .insert(spaces)
      .values({
        kind: 'personal',
        name: 'Personal space',
        personalOwnerId: actorId,
        createdBy: actorId,
      })
      .onConflictDoNothing()
      .returning({ id: spaces.id })
    const [space] = created
      ? [created]
      : await tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.personalOwnerId, actorId)).limit(1)
    if (!space) throw new Error('Personal space provisioning returned no row')
    await tx
      .insert(spaceMembers)
      .values({ spaceId: space.id, userId: actorId, role: 'owner' })
      .onConflictDoNothing({ target: [spaceMembers.spaceId, spaceMembers.userId] })
    return space.id
  }

  const insertProjectOwnerMembership = (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    projectId: string,
    actorId: string,
  ) =>
    tx.insert(projectMembers).values({
      projectId,
      userId: actorId,
      role: 'owner',
      createdBy: actorId,
    })

  const projectSummarySelection = (actorId: string) => ({
    id: projects.id,
    name: projects.name,
    description: projects.description,
    coverUrl: projects.coverUrl,
    draftVersion: projects.draftVersion,
    isFavorite: sql<boolean>`exists (
      select 1 from ${projectFavorites}
      where ${projectFavorites.projectId} = ${projects.id}
        and ${projectFavorites.userId} = ${actorId}
    )`,
    pageCount: projects.pageCount,
    canvasWidth: projects.canvasWidth,
    canvasHeight: projects.canvasHeight,
    startPageId: projects.startPageId,
    draftSavedAt: projects.draftSavedAt,
    thumbnailMode: projects.thumbnailMode,
    thumbnailStatus: projects.thumbnailStatus,
    thumbnailPath: projects.thumbnailPath,
    thumbnailUrl: projects.thumbnailUrl,
    thumbnailDraftVersion: projects.thumbnailDraftVersion,
    thumbnailErrorCode: projects.thumbnailErrorCode,
    publicationSlug: projectPublications.slug,
    publishedRevisionId: projectPublications.revisionId,
    publishedAt: projectPublications.publishedAt,
    currentReleaseNumber: projectReleases.releaseNumber,
    deletedAt: projects.deletedAt,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
  })

  const projectDetailSelection = (actorId: string) => ({
    ...projectSummarySelection(actorId),
    draftSchema: projects.draftSchema,
  })

  const canReadProject = (actorId: string) => sql<boolean>`exists (
    select 1 from ${projectMembers}
    where ${projectMembers.projectId} = ${projects.id}
      and ${projectMembers.userId} = ${actorId}
  )`

  const canEditProject = (actorId: string) => sql<boolean>`exists (
    select 1 from ${projectMembers}
    where ${projectMembers.projectId} = ${projects.id}
      and ${projectMembers.userId} = ${actorId}
      and ${projectMembers.role} in ('owner', 'editor')
  )`

  const canOwnProject = (actorId: string) => sql<boolean>`exists (
    select 1 from ${projectMembers}
    where ${projectMembers.projectId} = ${projects.id}
      and ${projectMembers.userId} = ${actorId}
      and ${projectMembers.role} = 'owner'
  )`

  const canEditAgentAssetProject = (actorId: string) => sql<boolean>`exists (
    select 1
    from ${projects}
    inner join ${projectMembers} on ${projectMembers.projectId} = ${projects.id}
    where ${projects.id} = ${agentAssets.projectId}
      and ${projects.deletedAt} is null
      and ${projectMembers.userId} = ${actorId}
      and ${projectMembers.role} in ('owner', 'editor')
  )`

  const lockAgentSpikeOperation = (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
    operationId: string,
  ) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:${operationId}`}, 0))`)

  const selectAgentSpikeOperation = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
    operationId: string,
    lock = false,
  ): Promise<AgentSpikeOperationRecord | null> => {
    const query = tx
      .select()
      .from(agentSpikeOperations)
      .where(and(eq(agentSpikeOperations.actorId, actorId), eq(agentSpikeOperations.operationId, operationId)))
    const rows = lock ? await query.for('update').limit(1) : await query.limit(1)
    return (rows[0] as AgentSpikeOperationRecord | undefined) ?? null
  }

  const agentSpikeBindingMatches = (
    operation: AgentSpikeOperationRecord,
    binding: AgentSpikeOperationBinding,
  ): boolean =>
    operation.projectId === binding.projectId &&
    operation.taskId === binding.taskId &&
    operation.stageId === binding.stageId &&
    operation.executorId === binding.executorId &&
    operation.operationId === binding.operationId

  const agentRunDispatchAllowsOperation = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
    operationId: string,
    authority: AgentMutationAuthority,
  ): Promise<{ dispatchExists: boolean; allowed: boolean }> => {
    const result = (await tx.execute(sql`
      select
        dispatch.id,
        dispatch.state,
        dispatch.desired_state,
        dispatch.lease_owner,
        dispatch.generation,
        dispatch.lease_until > now() as lease_active
      from app.agent_run_dispatches as dispatch
      where dispatch.actor_id = ${actorId}
        and dispatch.operation_id = ${operationId}
      limit 1
      for update
    `)) as unknown as {
      rows?: Array<{
        id: string
        state: string
        desired_state: string
        lease_owner: string | null
        generation: number
        lease_active: boolean
      }>
    }
    const dispatch = result?.rows?.[0]
    if (!dispatch) return { dispatchExists: false, allowed: !authority.dispatchAttempt }
    const attempt = authority.dispatchAttempt
    return {
      dispatchExists: true,
      allowed:
        !!attempt &&
        attempt.dispatchId === dispatch.id &&
        attempt.workerId === dispatch.lease_owner &&
        attempt.leaseGeneration === dispatch.generation &&
        dispatch.state === 'running' &&
        dispatch.desired_state === 'running' &&
        dispatch.lease_active === true,
    }
  }

  const thumbnailStorage = (accessToken: string) =>
    createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }).storage.from(THUMBNAIL_BUCKET)
  const agentAssetStorage = (accessToken: string) =>
    createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }).storage.from(AGENT_ASSET_BUCKET)

  const failAgentAssetUpload = async (actorId: string, accessToken: string, id: string) => {
    const failed = await withActor(actorId, async tx => {
      const [updated] = await tx
        .update(agentAssets)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(and(eq(agentAssets.id, id), eq(agentAssets.actorId, actorId), eq(agentAssets.status, 'uploading')))
        .returning({ storagePath: agentAssets.storagePath })
      return updated?.storagePath ?? null
    })
    if (!failed) return
    await agentAssetStorage(accessToken)
      .remove([failed])
      .catch(() => undefined)
  }

  const selectProjectDetail = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
    projectId: string,
    deleted: 'active' | 'trashed' = 'active',
  ) => {
    const [project] = await tx
      .select(projectDetailSelection(actorId))
      .from(projects)
      .leftJoin(
        projectPublications,
        and(eq(projectPublications.projectId, projects.id), eq(projectPublications.isPublished, true)),
      )
      .leftJoin(
        projectReleases,
        and(eq(projectReleases.projectId, projects.id), eq(projectReleases.revisionId, projectPublications.revisionId)),
      )
      .where(
        and(
          eq(projects.id, projectId),
          canReadProject(actorId),
          deleted === 'active' ? isNull(projects.deletedAt) : isNotNull(projects.deletedAt),
        ),
      )
      .limit(1)
    return project ?? null
  }

  const insertRevision = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    input: {
      actorId: string
      projectId: string
      schema: ProjectSchema
      kind: 'auto' | 'manual' | 'pre_restore' | 'publish' | 'agent'
      sourceDraftVersion: number
      label?: string | null
    },
  ) => {
    const [latest] = await tx
      .select({ value: max(projectRevisions.revisionNumber) })
      .from(projectRevisions)
      .where(eq(projectRevisions.projectId, input.projectId))
    const [revision] = await tx
      .insert(projectRevisions)
      .values({
        projectId: input.projectId,
        revisionNumber: (latest?.value ?? 0) + 1,
        schema: input.schema,
        kind: input.kind,
        sourceDraftVersion: input.sourceDraftVersion,
        label: input.label ?? null,
        createdBy: input.actorId,
      })
      .returning()
    if (!revision) throw new Error('Revision insert returned no row')
    return revision
  }

  const toPublicProject = (row: {
    slug: string
    projectId: string
    name: string
    description: string | null
    revisionId: string
    revisionNumber: number
    releaseNumber: number
    schema: ProjectSchema
    publishedAt: Date
  }): PublicProject => row

  const reconcileThumbnailArtifacts = async (actorId: string, accessToken: string, projectId: string) => {
    const now = new Date()
    const candidates = await withActor(actorId, async tx => {
      const [project] = await tx
        .select({
          id: projects.id,
          deletedAt: projects.deletedAt,
          currentPath: projects.thumbnailPath,
          pendingPath: projects.thumbnailPendingPath,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), canEditProject(actorId)))
        .for('update')
        .limit(1)
      if (!project) return null

      await tx
        .update(projectThumbnailArtifacts)
        .set({
          status: 'cleanup_pending',
          nextCleanupAt: now,
          lastError: 'upload-expired',
          updatedAt: now,
        })
        .where(
          and(
            eq(projectThumbnailArtifacts.projectId, projectId),
            eq(projectThumbnailArtifacts.status, 'pending'),
            lte(projectThumbnailArtifacts.expiresAt, now),
          ),
        )

      if (project.pendingPath) {
        const [pending] = await tx
          .select({ status: projectThumbnailArtifacts.status })
          .from(projectThumbnailArtifacts)
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, project.pendingPath),
            ),
          )
          .limit(1)
        if (pending?.status === 'cleanup_pending') {
          await tx
            .update(projects)
            .set({
              thumbnailStatus: 'failed',
              thumbnailErrorCode: 'upload-expired',
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(and(eq(projects.id, projectId), eq(projects.thumbnailPendingPath, project.pendingPath)))
        }
      }

      if (project.deletedAt) {
        await tx
          .update(projectThumbnailArtifacts)
          .set({
            status: 'cleanup_pending',
            nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, ${now})`,
            updatedAt: now,
          })
          .where(
            and(eq(projectThumbnailArtifacts.projectId, projectId), ne(projectThumbnailArtifacts.status, 'deleted')),
          )
        await tx
          .update(projects)
          .set({
            thumbnailPath: null,
            thumbnailUrl: null,
            thumbnailDraftVersion: null,
            thumbnailStatus: 'queued',
            thumbnailErrorCode: null,
            thumbnailRequestedVersion: null,
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
          })
          .where(eq(projects.id, projectId))
      }

      return tx
        .select({ path: projectThumbnailArtifacts.path })
        .from(projectThumbnailArtifacts)
        .where(
          and(
            eq(projectThumbnailArtifacts.projectId, projectId),
            eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
            or(isNull(projectThumbnailArtifacts.nextCleanupAt), lte(projectThumbnailArtifacts.nextCleanupAt, now)),
            project.deletedAt || !project.currentPath
              ? undefined
              : ne(projectThumbnailArtifacts.path, project.currentPath),
          ),
        )
    })
    if (!candidates) return null

    let deleted = 0
    let retryPending = 0
    for (const candidate of candidates) {
      const { error } = await thumbnailStorage(accessToken).remove([candidate.path])
      if (!error) {
        const removed = await withActor(actorId, async tx => {
          const [artifact] = await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'deleted',
              deletedAt: new Date(),
              nextCleanupAt: null,
              lastError: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, candidate.path),
                eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
                sql`not exists (
                  select 1 from ${projects}
                  where ${projects.id} = ${projectId}
                    and ${projects.thumbnailPath} = ${candidate.path}
                )`,
              ),
            )
            .returning({ id: projectThumbnailArtifacts.id })
          return Boolean(artifact)
        })
        if (removed) deleted += 1
        continue
      }

      retryPending += 1
      await withActor(actorId, async tx => {
        await tx
          .update(projectThumbnailArtifacts)
          .set({
            cleanupAttempts: sql`${projectThumbnailArtifacts.cleanupAttempts} + 1`,
            nextCleanupAt: new Date(Date.now() + THUMBNAIL_CLEANUP_RETRY_MS),
            lastError: error.message.slice(0, 500),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, candidate.path),
              eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
            ),
          )
      })
    }
    return { deleted, retryPending }
  }

  return {
    async ping() {
      await pool.query(`
        select
          releases.release_number,
          releases.publish_snapshot_id,
          publish_snapshots.document_sha256,
          preview_runs.renderer_sha256,
          publish_approvals.consumed_release_id,
          releases.name,
          releases.description,
          thumbnail_artifacts.path,
          thumbnail_artifacts.status,
          agent_operations.status as agent_operation_status,
          agent_costs.billing_scope as agent_cost_billing_scope,
          agent_costs.payer_id as agent_cost_payer_id,
          agent_costs.turn_id as agent_cost_turn_id,
          agent_costs.decision_output as agent_cost_decision_output,
          agent_costs.decision_usage as agent_cost_decision_usage,
          agent_costs.decision_trace as agent_cost_decision_trace,
          agent_dispatches.desired_state as agent_dispatch_desired_state,
          agent_dispatches.generation as agent_dispatch_generation,
          agent_assets.idempotency_key as agent_asset_idempotency_key,
          agent_assets.storage_cleanup_status as agent_asset_storage_cleanup_status,
          agent_assets.storage_cleanup_attempts as agent_asset_storage_cleanup_attempts,
          project_members.role as project_member_role,
          projects.agent_model_configuration,
          projects.agent_start_idempotency_key,
          projects.agent_start_input_digest,
          projects.permanent_delete_token,
          projects.permanent_delete_started_at
        from app.project_releases as releases
        cross join app.project_publish_snapshots as publish_snapshots
        cross join app.project_preview_runs as preview_runs
        cross join app.project_publish_approvals as publish_approvals
        cross join app.project_thumbnail_artifacts as thumbnail_artifacts
        cross join app.agent_spike_operations as agent_operations
        cross join app.agent_run_costs as agent_costs
        cross join app.agent_run_dispatches as agent_dispatches
        cross join app.agent_assets as agent_assets
        cross join app.project_members as project_members
        cross join app.projects as projects
        limit 0
      `)
    },
    ensurePersonalSpace(actorId) {
      return withActor(actorId, tx => ensurePersonalSpaceWithTx(tx, actorId))
    },
    listProjects(actorId, scope = 'active') {
      return withActor(actorId, tx =>
        tx
          .select(projectSummarySelection(actorId))
          .from(projects)
          .leftJoin(
            projectPublications,
            and(eq(projectPublications.projectId, projects.id), eq(projectPublications.isPublished, true)),
          )
          .leftJoin(
            projectReleases,
            and(
              eq(projectReleases.projectId, projects.id),
              eq(projectReleases.revisionId, projectPublications.revisionId),
            ),
          )
          .where(
            and(
              canReadProject(actorId),
              scope === 'trashed' ? isNotNull(projects.deletedAt) : isNull(projects.deletedAt),
            ),
          )
          .orderBy(
            desc(sql<boolean>`exists (
              select 1 from ${projectFavorites}
              where ${projectFavorites.projectId} = ${projects.id}
                and ${projectFavorites.userId} = ${actorId}
            )`),
            desc(projects.updatedAt),
          ),
      )
    },
    createProject(actorId, input) {
      return withActor(actorId, async tx => {
        const spaceId = await ensurePersonalSpaceWithTx(tx, actorId)
        const metadata = projectMetadata(input.schema)
        const projectId = randomUUID()
        await tx.insert(projects).values({
          id: projectId,
          ownerId: actorId,
          spaceId,
          name: input.name,
          description: input.description ?? null,
          coverUrl: input.coverUrl ?? null,
          draftSchema: input.schema,
          ...metadata,
        })
        await insertProjectOwnerMembership(tx, projectId, actorId)
        const project = await selectProjectDetail(tx, actorId, projectId)
        if (!project) throw new Error('Created project could not be read')
        return project
      })
    },
    startAgentProject(actorId, input) {
      return withActor(actorId, async tx => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-start:${input.idempotencyKey}`}, 0))`,
        )
        const [existing] = await tx
          .select({ id: projects.id, inputDigest: projects.agentStartInputDigest })
          .from(projects)
          .where(and(eq(projects.ownerId, actorId), eq(projects.agentStartIdempotencyKey, input.idempotencyKey)))
          .limit(1)
        if (existing) {
          if (existing.inputDigest !== input.inputDigest) return 'conflict'
          const [workspace] = await tx
            .select()
            .from(agentWorkspaces)
            .where(and(eq(agentWorkspaces.ownerId, actorId), eq(agentWorkspaces.projectId, existing.id)))
            .limit(1)
          const project = await selectProjectDetail(tx, actorId, existing.id)
          const [dispatch] = await tx
            .select()
            .from(agentRunDispatches)
            .where(
              and(
                eq(agentRunDispatches.actorId, actorId),
                eq(agentRunDispatches.projectId, existing.id),
                eq(agentRunDispatches.kind, 'initial'),
              ),
            )
            .limit(1)
          if (!workspace || !project || !dispatch) throw new Error('Idempotent Agent start could not be replayed')
          return {
            project,
            workspace: workspace as AgentWorkspaceRecord,
            dispatch: dispatch as AgentRunDispatchRecord,
          } satisfies AgentProjectStartRecord
        }
        const spaceId = await ensurePersonalSpaceWithTx(tx, actorId)
        const metadata = projectMetadata(input.project.schema)
        await tx.insert(projects).values({
          id: input.project.id,
          ownerId: actorId,
          spaceId,
          name: input.project.name,
          description: input.project.description ?? null,
          coverUrl: input.project.coverUrl ?? null,
          draftSchema: input.project.schema,
          agentStartIdempotencyKey: input.idempotencyKey,
          agentStartInputDigest: input.inputDigest,
          ...metadata,
        })
        await insertProjectOwnerMembership(tx, input.project.id, actorId)
        const [workspace] = await tx
          .insert(agentWorkspaces)
          .values({
            ownerId: actorId,
            projectId: input.project.id,
            payload: input.workspacePayload,
          })
          .returning()
        if (!workspace) throw new Error('Agent workspace insert returned no row')
        const [dispatch] = await tx
          .insert(agentRunDispatches)
          .values({
            actorId,
            projectId: input.project.id,
            conversationId: input.dispatch.conversationId,
            taskId: input.dispatch.taskId,
            operationId: input.dispatch.operationId,
            kind: 'initial',
            state: input.dispatch.waitingForUpload ? 'paused' : 'queued',
            desiredState: input.dispatch.waitingForUpload ? 'paused' : 'running',
            waitingReason: input.dispatch.waitingForUpload ? 'upload' : null,
          })
          .returning()
        if (!dispatch) throw new Error('Agent initial dispatch insert returned no row')
        const project = await selectProjectDetail(tx, actorId, input.project.id)
        if (!project) throw new Error('Created Agent project could not be read')
        return {
          project,
          workspace: workspace as AgentWorkspaceRecord,
          dispatch: dispatch as AgentRunDispatchRecord,
        } satisfies AgentProjectStartRecord
      })
    },
    getProject(actorId, projectId) {
      return withActor(actorId, async tx => {
        return selectProjectDetail(tx, actorId, projectId)
      })
    },
    listProjectMembers(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [membership] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorId)))
          .limit(1)
        if (!membership) return null
        return tx
          .select()
          .from(projectMembers)
          .where(eq(projectMembers.projectId, projectId))
          .orderBy(asc(projectMembers.createdAt), asc(projectMembers.userId))
      })
    },
    setProjectMemberRole(actorId, projectId, userId, role) {
      return withActor(actorId, async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${projectId}:project-members`}, 0))`)
        const [membership] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorId)))
          .limit(1)
        if (!membership) return null
        if (membership.role !== 'owner') return 'forbidden'
        const [target] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
          .limit(1)
        if (target?.role === 'owner' && role !== 'owner') {
          const [{ ownerCount = 0 } = {}] = await tx
            .select({ ownerCount: sql<number>`count(*)::integer` })
            .from(projectMembers)
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'owner')))
          if (ownerCount <= 1) return 'last_owner'
        }
        const [updated] = await tx
          .insert(projectMembers)
          .values({ projectId, userId, role, createdBy: actorId })
          .onConflictDoUpdate({
            target: [projectMembers.projectId, projectMembers.userId],
            set: { role },
          })
          .returning()
        return updated ?? null
      })
    },
    removeProjectMember(actorId, projectId, userId) {
      return withActor(actorId, async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${projectId}:project-members`}, 0))`)
        const [membership] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorId)))
          .limit(1)
        if (!membership) return null
        if (membership.role !== 'owner') return 'forbidden'
        const [target] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
          .limit(1)
        if (!target) return null
        if (target.role === 'owner') {
          const [{ ownerCount = 0 } = {}] = await tx
            .select({ ownerCount: sql<number>`count(*)::integer` })
            .from(projectMembers)
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'owner')))
          if (ownerCount <= 1) return 'last_owner'
        }
        const [removed] = await tx
          .delete(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
          .returning({ userId: projectMembers.userId })
        return removed ? true : null
      })
    },
    isProjectOwner(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
          .where(
            and(
              eq(projects.id, projectId),
              eq(projectMembers.userId, actorId),
              eq(projectMembers.role, 'owner'),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return Boolean(project)
      })
    },
    getAgentProjectModelConfig(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ config: projects.agentModelConfiguration })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        return project?.config ?? null
      })
    },
    updateAgentProjectModelConfig(actorId, projectId, config) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projects)
          .set({ agentModelConfiguration: config, updatedAt: new Date() })
          .where(and(eq(projects.id, projectId), canOwnProject(actorId), isNull(projects.deletedAt)))
          .returning({ id: projects.id })
        return Boolean(updated)
      })
    },
    compareAndSetAgentProjectModelConfig(actorId, projectId, expected, config) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projects)
          .set({ agentModelConfiguration: config, updatedAt: new Date() })
          .where(
            and(
              eq(projects.id, projectId),
              canOwnProject(actorId),
              sql`${projects.agentModelConfiguration} = ${JSON.stringify(expected)}::jsonb`,
              isNull(projects.deletedAt),
            ),
          )
          .returning({ id: projects.id })
        return Boolean(updated)
      })
    },
    getEditableProjectForAgentSpike(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            draftVersion: projects.draftVersion,
            draftSchema: projects.draftSchema,
          })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        return project ?? null
      })
    },
    issueAgentSpikeOperation(actorId, input) {
      return withActor(actorId, async tx => {
        await lockAgentSpikeOperation(tx, actorId, input.operationId)
        const issueDigest = agentSpikeIssueDigest({
          actorId,
          projectId: input.projectId,
          taskId: input.taskId,
          stageId: input.stageId,
          executorId: input.executorId,
          operationId: input.operationId,
          grantJti: input.grantJti,
          baseDraftVersion: input.baseDraftVersion,
          inputDigest: input.inputDigest,
          executorInput: input.executorInput,
          compatibility: input.compatibility,
          expiresAt: input.expiresAt,
          ...(input.skillTrace === undefined ? {} : { skillTrace: input.skillTrace }),
        })
        const existing = await selectAgentSpikeOperation(tx, actorId, input.operationId, true)
        if (existing) {
          return compareAgentSpikeDigest(existing.issueDigest, issueDigest) === 'same'
            ? existing
            : ('integrity_conflict' as const)
        }
        if (input.expiresAt.getTime() <= Date.now()) return 'invalid_state'
        const [project] = await tx
          .select({ id: projects.id, draftVersion: projects.draftVersion, draftSchema: projects.draftSchema })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (project.draftVersion !== input.baseDraftVersion) return 'conflict'
        const [operation] = await tx
          .insert(agentSpikeOperations)
          .values({
            actorId,
            projectId: input.projectId,
            taskId: input.taskId,
            stageId: input.stageId,
            executorId: input.executorId,
            operationId: input.operationId,
            grantJti: input.grantJti,
            baseDraftVersion: input.baseDraftVersion,
            inputDigest: input.inputDigest,
            executorInput: input.executorInput,
            issueDigest,
            skillTrace: input.skillTrace,
            compatibility: input.compatibility,
            expiresAt: input.expiresAt,
          })
          .returning()
        if (!operation) throw new Error('Agent spike operation insert returned no row')
        return operation
      })
    },
    prepareAgentSpikeOperation(
      actorId,
      binding,
      authorityOrInput:
        | AgentMutationAuthority
        | { candidateSchema: ProjectSchema; hostReceipt: Record<string, unknown>; evidence: Record<string, unknown> },
      maybeInput?: {
        candidateSchema: ProjectSchema
        hostReceipt: Record<string, unknown>
        evidence: Record<string, unknown>
      },
    ) {
      const authority = maybeInput ? (authorityOrInput as AgentMutationAuthority) : {}
      const input = (maybeInput ?? authorityOrInput) as {
        candidateSchema: ProjectSchema
        hostReceipt: Record<string, unknown>
        evidence: Record<string, unknown>
      }
      return withActor(actorId, async tx => {
        await lockAgentSpikeOperation(tx, actorId, binding.operationId)
        const operation = await selectAgentSpikeOperation(tx, actorId, binding.operationId, true)
        if (!operation) return null
        if (!agentSpikeBindingMatches(operation, binding)) return 'integrity_conflict'
        const dispatchFence = await agentRunDispatchAllowsOperation(tx, actorId, binding.operationId, authority)
        if (!dispatchFence.allowed) return 'attempt_stale'
        const candidateDigest = agentSpikeCandidateDigest(input.candidateSchema)
        const preparedDigest = agentSpikePreparedDigest(input)
        if (operation.status !== 'issued') {
          if (
            !operation.preparedDigest ||
            compareAgentSpikeDigest(operation.preparedDigest, preparedDigest) === 'integrity_conflict'
          ) {
            return 'integrity_conflict'
          }
          return operation.status === 'prepared' || operation.status === 'committed' ? operation : 'invalid_state'
        }
        if (!dispatchFence.dispatchExists && operation.expiresAt.getTime() <= Date.now()) {
          const completedAt = new Date()
          await tx
            .update(agentSpikeOperations)
            .set({
              status: 'failed_not_applied',
              outcome: { status: 'failed_not_applied', reason: 'operation_expired' },
              completedAt,
              updatedAt: completedAt,
            })
            .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'issued')))
          return 'invalid_state'
        }
        const preparedAt = new Date()
        const [prepared] = await tx
          .update(agentSpikeOperations)
          .set({
            status: 'prepared',
            candidateDigest,
            preparedDigest,
            candidateSchema: input.candidateSchema,
            hostReceipt: input.hostReceipt,
            evidence: input.evidence,
            preparedAt,
            updatedAt: preparedAt,
          })
          .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'issued')))
          .returning()
        if (!prepared) throw new Error('Agent spike operation prepare returned no row')
        return prepared
      })
    },
    commitAgentSpikeStage(actorId, binding, authority = {}) {
      return withActor(actorId, async tx => {
        await lockAgentSpikeOperation(tx, actorId, binding.operationId)
        const operation = await selectAgentSpikeOperation(tx, actorId, binding.operationId, true)
        if (!operation) return null
        if (!agentSpikeBindingMatches(operation, binding)) return 'integrity_conflict'
        const dispatchFence = await agentRunDispatchAllowsOperation(tx, actorId, binding.operationId, authority)
        if (!dispatchFence.allowed) return 'attempt_stale'
        if (operation.status === 'committed') return operation
        if (
          operation.status !== 'prepared' ||
          !operation.candidateSchema ||
          !operation.candidateDigest ||
          !operation.preparedDigest ||
          !operation.hostReceipt ||
          !operation.evidence
        ) {
          return 'invalid_state'
        }
        if (!dispatchFence.dispatchExists && operation.expiresAt.getTime() <= Date.now()) {
          const completedAt = new Date()
          await tx
            .update(agentSpikeOperations)
            .set({
              status: 'failed_not_applied',
              outcome: { status: 'failed_not_applied', reason: 'operation_expired' },
              completedAt,
              updatedAt: completedAt,
            })
            .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'prepared')))
          return 'invalid_state'
        }
        const candidateDigest = agentSpikeCandidateDigest(operation.candidateSchema)
        const preparedDigest = agentSpikePreparedDigest({
          candidateSchema: operation.candidateSchema,
          hostReceipt: operation.hostReceipt,
          evidence: operation.evidence,
        })
        if (candidateDigest !== operation.candidateDigest || preparedDigest !== operation.preparedDigest) {
          const completedAt = new Date()
          await tx
            .update(agentSpikeOperations)
            .set({
              status: 'indeterminate',
              outcome: { status: 'indeterminate', reason: 'persisted_prepare_digest_mismatch' },
              completedAt,
              updatedAt: completedAt,
            })
            .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'prepared')))
          return 'integrity_conflict'
        }

        const [project] = await tx
          .select({ id: projects.id, draftVersion: projects.draftVersion, draftSchema: projects.draftSchema })
          .from(projects)
          .where(and(eq(projects.id, binding.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        const completedAt = new Date()
        if (project.draftVersion !== operation.baseDraftVersion) {
          await tx
            .update(agentSpikeOperations)
            .set({
              status: 'rejected_stale',
              outcome: {
                status: 'rejected_stale',
                expectedDraftVersion: operation.baseDraftVersion,
                actualDraftVersion: project.draftVersion,
              },
              completedAt,
              updatedAt: completedAt,
            })
            .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'prepared')))
          return 'conflict'
        }

        const rollbackRevision = await insertRevision(tx, {
          actorId,
          projectId: binding.projectId,
          schema: project.draftSchema,
          kind: 'agent',
          sourceDraftVersion: project.draftVersion,
          label: `Agent 执行前 · ${binding.taskId}`.slice(0, 120),
        })

        const committedDraftVersion = operation.baseDraftVersion + 1
        const [updated] = await tx
          .update(projects)
          .set({
            draftSchema: operation.candidateSchema,
            draftVersion: committedDraftVersion,
            draftSavedAt: completedAt,
            ...projectMetadata(operation.candidateSchema),
            thumbnailStatus: sql`case
              when ${projects.thumbnailMode} = 'auto' then 'queued'
              when ${projects.thumbnailPath} is not null then 'ready'
              else 'failed'
            end`,
            thumbnailRequestedVersion: thumbnailRequestedVersionCase(committedDraftVersion),
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            thumbnailErrorCode: sql`case
              when ${projects.thumbnailMode} = 'auto' then null
              when ${projects.thumbnailPath} is not null then null
              else 'draft-version-changed'
            end`,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(projects.id, binding.projectId),
              canEditProject(actorId),
              eq(projects.draftVersion, operation.baseDraftVersion),
              isNull(projects.deletedAt),
            ),
          )
          .returning({ id: projects.id })
        if (!updated) {
          throw new Error('Locked Agent spike project failed its draft-version compare-and-set')
        }

        const [latestAuto] = await tx
          .select({ createdAt: projectRevisions.createdAt })
          .from(projectRevisions)
          .where(and(eq(projectRevisions.projectId, binding.projectId), eq(projectRevisions.kind, 'auto')))
          .orderBy(desc(projectRevisions.createdAt))
          .limit(1)
        if (!latestAuto || completedAt.getTime() - latestAuto.createdAt.getTime() >= 5 * 60 * 1000) {
          await insertRevision(tx, {
            actorId,
            projectId: binding.projectId,
            schema: operation.candidateSchema,
            kind: 'auto',
            sourceDraftVersion: committedDraftVersion,
          })
        }

        const outcome = {
          status: 'committed',
          committedDraftVersion,
          candidateDigest: operation.candidateDigest,
          rollbackRevisionId: rollbackRevision.id,
        }
        const [committed] = await tx
          .update(agentSpikeOperations)
          .set({
            status: 'committed',
            committedDraftVersion,
            rollbackRevisionId: rollbackRevision.id,
            outcome,
            completedAt,
            updatedAt: completedAt,
          })
          .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'prepared')))
          .returning()
        if (!committed) throw new Error('Agent spike committed outcome returned no row')
        return committed
      })
    },
    getAgentSpikeOperationOutcome(actorId, operationId) {
      return withActor(actorId, tx => selectAgentSpikeOperation(tx, actorId, operationId))
    },
    getAgentSpikeOperationOutcomeByTask(actorId, projectId, taskId) {
      return withActor(actorId, async tx => {
        const [operation] = await tx
          .select()
          .from(agentSpikeOperations)
          .where(
            and(
              eq(agentSpikeOperations.actorId, actorId),
              eq(agentSpikeOperations.projectId, projectId),
              eq(agentSpikeOperations.taskId, taskId),
            ),
          )
          .orderBy(desc(agentSpikeOperations.createdAt))
          .limit(1)
        return (operation as AgentSpikeOperationRecord | undefined) ?? null
      })
    },
    enqueueAgentRunDispatch(actorId, input) {
      return withActor(actorId, async tx => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-dispatch:${input.operationId}`}, 0))`,
        )
        const [existing] = await tx
          .select()
          .from(agentRunDispatches)
          .where(and(eq(agentRunDispatches.actorId, actorId), eq(agentRunDispatches.operationId, input.operationId)))
          .limit(1)
        if (existing) {
          const matches =
            existing.projectId === input.projectId &&
            existing.conversationId === input.conversationId &&
            existing.taskId === input.taskId
          if (!matches) throw new Error('Agent run dispatch operation was rebound to a different task')
          return existing as AgentRunDispatchRecord
        }
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        const [created] = await tx
          .insert(agentRunDispatches)
          .values({
            actorId,
            projectId: input.projectId,
            conversationId: input.conversationId,
            taskId: input.taskId,
            operationId: input.operationId,
            ...(input.now ? { createdAt: input.now, updatedAt: input.now } : {}),
          })
          .returning()
        if (!created) throw new Error('Agent run dispatch insert returned no row')
        return created as AgentRunDispatchRecord
      })
    },
    enqueueAgentTurn(actorId, input) {
      return withActor(actorId, async tx => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-turn:${input.projectId}:${input.turnId}`}, 0))`,
        )
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null

        const [existingDispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, input.projectId),
              or(
                eq(agentRunDispatches.operationId, input.operationId),
                eq(agentRunDispatches.turnId, input.turnId),
                and(
                  eq(agentRunDispatches.kind, 'initial'),
                  eq(agentRunDispatches.taskId, input.taskId),
                  isNull(agentRunDispatches.turnId),
                ),
              ),
            ),
          )
          .for('update')
          .limit(1)
        if (
          existingDispatch &&
          ((existingDispatch.turnId !== null && existingDispatch.turnId !== input.turnId) ||
            existingDispatch.taskId !== input.taskId ||
            (existingDispatch.inputDigest !== null && existingDispatch.inputDigest !== input.inputDigest))
        ) {
          return 'conflict'
        }

        const [existingCost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.turnId, input.turnId),
            ),
          )
          .for('update')
          .limit(1)
        if (existingCost && (existingCost.taskId !== input.taskId || existingCost.inputDigest !== input.inputDigest)) {
          return 'conflict'
        }

        let cost = existingCost
        if (!cost) {
          if (input.reservedMicros > input.taskLimitMicros) return 'task_budget_exceeded'
          await tx.execute(sql`
            select pg_advisory_xact_lock(hashtextextended(
              ${`agent-budget:${input.billingScope}:${input.payerId}:`} ||
              to_char(${input.now} at time zone 'UTC', 'YYYY-MM'),
              0
            ))
          `)
          const chargedMicros = sql<number>`case
            when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
            when ${agentRunCosts.accuracy} = 'billing_indeterminate'
              then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
            else ${agentRunCosts.settledMicros}
          end`
          const [usage] = await tx
            .select({
              taskMicros: sql<number>`coalesce(sum(case
                when ${agentRunCosts.actorId} = ${actorId}
                  and ${agentRunCosts.projectId} = ${input.projectId}
                  and ${agentRunCosts.taskId} = ${input.taskId}
                  then ${chargedMicros}
                else 0
              end), 0)`,
              projectMonthMicros: sql<number>`coalesce(sum(case
                when ${agentRunCosts.billingScope} = ${input.billingScope}
                  and ${agentRunCosts.payerId} = ${input.payerId}
                  and (${input.billingScope} = 'user' or ${agentRunCosts.projectId} = ${input.projectId})
                  and ${agentRunCosts.createdAt} >= date_trunc('month', ${input.now} at time zone 'UTC') at time zone 'UTC'
                  then ${chargedMicros}
                else 0
              end), 0)`,
            })
            .from(agentRunCosts)
            .where(ne(agentRunCosts.state, 'released'))
          if (Number(usage?.taskMicros ?? 0) + input.reservedMicros > input.taskLimitMicros) {
            return 'task_budget_exceeded'
          }
          if (Number(usage?.projectMonthMicros ?? 0) + input.reservedMicros > input.projectMonthLimitMicros) {
            return 'project_budget_exceeded'
          }
          const [createdCost] = await tx
            .insert(agentRunCosts)
            .values({
              actorId,
              projectId: input.projectId,
              taskId: input.taskId,
              turnId: input.turnId,
              inputDigest: input.inputDigest,
              operationId: existingDispatch?.operationId ?? input.operationId,
              provider: input.provider,
              model: input.model,
              profile: input.profileId,
              state: 'reserved',
              accuracy: null,
              reservedMicros: input.reservedMicros,
              billingScope: input.billingScope,
              payerId: input.payerId,
              reservationExpiresAt: input.reservationExpiresAt,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .returning()
          if (!createdCost) throw new Error('Agent turn cost insert returned no row')
          cost = createdCost
        }

        const inputSnapshot = {
          prompt: input.prompt,
          attachmentIds: [...input.attachmentIds],
          projectContext: structuredClone(input.projectContext),
          endpoint: input.endpoint,
          projectDraftVersion: input.projectDraftVersion,
          reservedMicros: input.reservedMicros,
          maximumRateMicrosPerToken: input.maximumRateMicrosPerToken,
          providerInputSnapshot: structuredClone(input.providerInputSnapshot),
          providerRequestKey: input.providerRequestKey,
        }
        const frozenConfigDigest = canonicalJsonSha256({
          provider: input.provider,
          model: input.model,
          profileId: input.profileId,
          endpoint: input.endpoint,
          billingScope: input.billingScope,
          payerId: input.payerId,
          taskLimitMicros: input.taskLimitMicros,
          projectMonthLimitMicros: input.projectMonthLimitMicros,
          idempotencyMode: input.idempotencyMode,
        })
        const dispatchValues = {
          turnId: input.turnId,
          inputDigest: input.inputDigest,
          inputSnapshot,
          phase: 'planning' as const,
          frozenProvider: input.provider,
          frozenModel: input.model,
          frozenProfile: input.profileId,
          frozenConfigDigest,
          billingScope: input.billingScope,
          payerId: input.payerId,
          taskLimitMicros: input.taskLimitMicros,
          projectLimitMicros: input.projectMonthLimitMicros,
          warningRatio: 0.8,
          providerIdempotency: input.idempotencyMode,
          updatedAt: input.now,
        }
        const dispatch = existingDispatch
          ? ((
              await tx
                .update(agentRunDispatches)
                .set(dispatchValues)
                .where(
                  and(
                    eq(agentRunDispatches.id, existingDispatch.id),
                    isNull(agentRunDispatches.turnId),
                    isNull(agentRunDispatches.inputDigest),
                  ),
                )
                .returning()
            )[0] ?? existingDispatch)
          : (
              await tx
                .insert(agentRunDispatches)
                .values({
                  actorId,
                  projectId: input.projectId,
                  conversationId: input.conversationId,
                  taskId: input.taskId,
                  operationId: input.operationId,
                  kind: 'run',
                  ...dispatchValues,
                  createdAt: input.now,
                })
                .returning()
            )[0]
        if (!dispatch) throw new Error('Agent turn dispatch persistence returned no row')
        const turn = durableTurnFromDispatch(dispatch)
        if (!turn) throw new Error('Agent turn dispatch did not contain a complete frozen turn')
        return {
          turn,
          dispatch: dispatch as AgentRunDispatchRecord,
          cost: cost as AgentRunCostRecord,
        }
      })
    },
    getAgentTurnByDispatch(actorId, dispatchId) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(and(eq(agentRunDispatches.id, dispatchId), eq(agentRunDispatches.actorId, actorId)))
          .limit(1)
        return dispatch ? durableTurnFromDispatch(dispatch) : null
      })
    },
    prepareAgentProviderAttempt(actorId, dispatchAttempt, input) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.id, dispatchAttempt.dispatchId),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, input.projectId),
              eq(agentRunDispatches.taskId, input.taskId),
              eq(agentRunDispatches.turnId, input.turnId),
              eq(agentRunDispatches.state, 'running'),
              eq(agentRunDispatches.desiredState, 'running'),
              eq(agentRunDispatches.leaseOwner, dispatchAttempt.workerId),
              eq(agentRunDispatches.generation, dispatchAttempt.leaseGeneration),
              gt(agentRunDispatches.leaseUntil, input.now),
            ),
          )
          .for('update')
          .limit(1)
        if (!dispatch || dispatch.providerIdempotency !== input.idempotencyMode) return 'stale'

        let [latest] = await tx
          .select()
          .from(agentProviderAttempts)
          .where(and(eq(agentProviderAttempts.actorId, actorId), eq(agentProviderAttempts.dispatchId, dispatch.id)))
          .orderBy(desc(agentProviderAttempts.attemptNo))
          .for('update')
          .limit(1)
        const [cost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.taskId, input.taskId),
              eq(agentRunCosts.turnId, input.turnId),
            ),
          )
          .for('update')
          .limit(1)
        if (!cost || dispatch.taskLimitMicros === null || dispatch.projectLimitMicros === null) return 'stale'

        if (
          latest &&
          (latest.dispatchGeneration !== dispatchAttempt.leaseGeneration ||
            latest.dispatchWorkerId !== dispatchAttempt.workerId)
        ) {
          if (latest.dispatchGeneration >= dispatchAttempt.leaseGeneration) return 'stale'
          if (latest.state === 'started') {
            const [unknown] = await tx
              .update(agentProviderAttempts)
              .set({
                state: 'outcome_unknown',
                costAccuracy: 'billing_indeterminate',
                amountMicros: cost.reservedMicros,
                minimumMicros: 0,
                maximumMicros: cost.reservedMicros,
                errorCode: 'dispatch_generation_reclaimed',
                completedAt: input.now,
                updatedAt: input.now,
              })
              .where(eq(agentProviderAttempts.id, latest.id))
              .returning()
            if (!unknown) return 'stale'
            await tx
              .update(agentRunCosts)
              .set({
                state: 'settled',
                accuracy: 'billing_indeterminate',
                settledMicros: cost.reservedMicros,
                minimumMicros: 0,
                maximumMicros: cost.reservedMicros,
                updatedAt: input.now,
              })
              .where(eq(agentRunCosts.id, cost.id))
            return 'outcome_unknown'
          }
          if (latest.state === 'prepared') {
            const [failed] = await tx
              .update(agentProviderAttempts)
              .set({
                state: 'failed_definite',
                costAccuracy: 'estimated',
                amountMicros: 0,
                minimumMicros: 0,
                maximumMicros: 0,
                errorCode: 'dispatch_generation_reclaimed_before_start',
                completedAt: input.now,
                updatedAt: input.now,
              })
              .where(eq(agentProviderAttempts.id, latest.id))
              .returning()
            if (!failed) return 'stale'
            latest = failed
            await tx
              .update(agentRunCosts)
              .set({
                state: 'released',
                accuracy: null,
                settledMicros: 0,
                minimumMicros: null,
                maximumMicros: null,
                updatedAt: input.now,
              })
              .where(eq(agentRunCosts.id, cost.id))
          }
        }
        if (
          latest &&
          latest.dispatchGeneration === dispatchAttempt.leaseGeneration &&
          latest.dispatchWorkerId === dispatchAttempt.workerId &&
          (latest.state === 'prepared' || latest.state === 'started')
        ) {
          if (
            latest.requestBodyDigest !== input.requestBodyDigest ||
            latest.providerRequestKey !== input.providerRequestKey
          ) {
            return 'stale'
          }
          return durableProviderAttempt(latest, input.idempotencyMode)
        }
        if (
          latest &&
          latest.dispatchGeneration === dispatchAttempt.leaseGeneration &&
          latest.dispatchWorkerId === dispatchAttempt.workerId
        ) {
          return 'stale'
        }
        if (latest && latest.state !== 'failed_definite') return 'stale'

        const reservationDeltaMicros = latest ? input.reservedMicros : 0
        if (reservationDeltaMicros > 0) {
          const [usage] = await tx
            .select({
              taskMicros: sql<number>`coalesce(sum(case
                when ${agentRunCosts.actorId} = ${actorId}
                  and ${agentRunCosts.projectId} = ${input.projectId}
                  and ${agentRunCosts.taskId} = ${input.taskId}
                  then case
                    when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
                    when ${agentRunCosts.accuracy} = 'billing_indeterminate'
                      then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
                    else ${agentRunCosts.settledMicros}
                  end
                else 0
              end), 0)`,
              projectMonthMicros: sql<number>`coalesce(sum(case
                when ${agentRunCosts.billingScope} = ${dispatch.billingScope}
                  and ${agentRunCosts.payerId} = ${dispatch.payerId}
                  and (${dispatch.billingScope} = 'user' or ${agentRunCosts.projectId} = ${input.projectId})
                  and ${agentRunCosts.createdAt} >= date_trunc('month', ${input.now} at time zone 'UTC') at time zone 'UTC'
                  then case
                    when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
                    when ${agentRunCosts.accuracy} = 'billing_indeterminate'
                      then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
                    else ${agentRunCosts.settledMicros}
                  end
                else 0
              end), 0)`,
            })
            .from(agentRunCosts)
            .where(ne(agentRunCosts.state, 'released'))
          if (Number(usage?.taskMicros ?? 0) + reservationDeltaMicros > dispatch.taskLimitMicros) {
            return 'task_budget_exceeded'
          }
          if (Number(usage?.projectMonthMicros ?? 0) + reservationDeltaMicros > dispatch.projectLimitMicros) {
            return 'project_budget_exceeded'
          }
          await tx
            .update(agentRunCosts)
            .set({
              state: 'reserved',
              accuracy: null,
              reservedMicros: reservationDeltaMicros,
              settledMicros: 0,
              minimumMicros: null,
              maximumMicros: null,
              updatedAt: input.now,
            })
            .where(eq(agentRunCosts.id, cost.id))
        }
        const [created] = await tx
          .insert(agentProviderAttempts)
          .values({
            actorId,
            projectId: input.projectId,
            dispatchId: dispatch.id,
            dispatchGeneration: dispatchAttempt.leaseGeneration,
            dispatchWorkerId: dispatchAttempt.workerId,
            attemptNo: (latest?.attemptNo ?? 0) + 1,
            providerRequestKey: input.providerRequestKey,
            requestBodyDigest: input.requestBodyDigest,
            state: 'prepared',
            reservationDeltaMicros,
            preparedAt: input.now,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning()
        if (!created) throw new Error('Agent provider attempt insert returned no row')
        return durableProviderAttempt(created, input.idempotencyMode)
      })
    },
    markAgentProviderAttemptStarted(actorId, attemptId, dispatchAttempt, now) {
      return withActor(actorId, async tx => {
        const [attempt] = await tx
          .update(agentProviderAttempts)
          .set({ state: 'started', startedAt: now, updatedAt: now })
          .where(
            and(
              eq(agentProviderAttempts.id, attemptId),
              eq(agentProviderAttempts.actorId, actorId),
              eq(agentProviderAttempts.dispatchId, dispatchAttempt.dispatchId),
              eq(agentProviderAttempts.dispatchGeneration, dispatchAttempt.leaseGeneration),
              eq(agentProviderAttempts.dispatchWorkerId, dispatchAttempt.workerId),
              eq(agentProviderAttempts.state, 'prepared'),
              sql`exists (
                select 1 from ${agentRunDispatches} dispatch
                where dispatch.id = ${dispatchAttempt.dispatchId}
                  and dispatch.actor_id = ${actorId}
                  and dispatch.state = 'running'
                  and dispatch.desired_state = 'running'
                  and dispatch.lease_owner = ${dispatchAttempt.workerId}
                  and dispatch.generation = ${dispatchAttempt.leaseGeneration}
                  and dispatch.lease_until > ${now}
              )`,
            ),
          )
          .returning()
        if (!attempt) return null
        const [dispatch] = await tx
          .select({ providerIdempotency: agentRunDispatches.providerIdempotency })
          .from(agentRunDispatches)
          .where(eq(agentRunDispatches.id, dispatchAttempt.dispatchId))
          .limit(1)
        return durableProviderAttempt(attempt, dispatch?.providerIdempotency ?? 'unsupported')
      })
    },
    completeAgentProviderAttempt(actorId, attemptId, dispatchAttempt, input) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.id, dispatchAttempt.dispatchId),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.state, 'running'),
              eq(agentRunDispatches.desiredState, 'running'),
              eq(agentRunDispatches.leaseOwner, dispatchAttempt.workerId),
              eq(agentRunDispatches.generation, dispatchAttempt.leaseGeneration),
              gt(agentRunDispatches.leaseUntil, input.now),
            ),
          )
          .for('update')
          .limit(1)
        if (!dispatch || !dispatch.turnId || !dispatch.providerIdempotency) return 'stale'
        const [attempt] = await tx
          .select()
          .from(agentProviderAttempts)
          .where(
            and(
              eq(agentProviderAttempts.id, attemptId),
              eq(agentProviderAttempts.actorId, actorId),
              eq(agentProviderAttempts.dispatchId, dispatch.id),
              eq(agentProviderAttempts.dispatchGeneration, dispatchAttempt.leaseGeneration),
              eq(agentProviderAttempts.dispatchWorkerId, dispatchAttempt.workerId),
            ),
          )
          .for('update')
          .limit(1)
        if (
          !attempt ||
          attempt.requestBodyDigest !== input.providerAttempt.requestBodyDigest ||
          attempt.providerRequestKey !== (input.providerAttempt.providerRequestKey ?? null) ||
          dispatch.providerIdempotency !== input.providerAttempt.idempotencyMode
        ) {
          return 'stale'
        }
        const [cost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, dispatch.projectId),
              eq(agentRunCosts.turnId, dispatch.turnId),
            ),
          )
          .for('update')
          .limit(1)
        if (!cost) return 'stale'
        if (['succeeded', 'failed_definite', 'outcome_unknown'].includes(attempt.state)) {
          return {
            attempt: durableProviderAttempt(attempt, dispatch.providerIdempotency),
            cost: cost as AgentRunCostRecord,
          }
        }
        if (attempt.state !== 'started' && input.state !== 'failed_definite') return 'stale'

        const publicCost =
          input.state === 'outcome_unknown'
            ? derivePublicCost({
                lifecycle: 'settled',
                outcome: 'unknown',
                reservedMicros: input.estimatedMicros ?? cost.reservedMicros,
                ...(input.observedTokens !== undefined
                  ? { observedTokens: input.observedTokens, microsPerToken: 1 }
                  : {}),
              })
            : input.state === 'succeeded'
              ? input.providerAmountMicros !== undefined
                ? derivePublicCost({
                    lifecycle: 'settled',
                    outcome: 'success',
                    providerAmountMicros: input.providerAmountMicros,
                  })
                : {
                    lifecycle: 'settled' as const,
                    accuracy: 'estimated' as const,
                    amountMicros: input.estimatedMicros ?? 0,
                    minimumMicros: input.estimatedMicros ?? 0,
                    maximumMicros: input.estimatedMicros ?? 0,
                    estimateInProgress: false,
                  }
              : {
                  lifecycle: 'settled' as const,
                  accuracy: 'estimated' as const,
                  amountMicros: 0,
                  minimumMicros: 0,
                  maximumMicros: 0,
                  estimateInProgress: false,
                }
        const [completed] = await tx
          .update(agentProviderAttempts)
          .set({
            state: input.state,
            costAccuracy: publicCost.accuracy,
            amountMicros: publicCost.amountMicros ?? 0,
            minimumMicros: publicCost.minimumMicros,
            maximumMicros: publicCost.maximumMicros,
            promptTokens: input.promptTokens ?? null,
            completionTokens: input.completionTokens ?? null,
            cachedTokens: input.cachedTokens ?? null,
            durationMs: input.providerAttempt.durationMs ?? null,
            upstreamRequestId: input.providerAttempt.upstreamRequestId ?? null,
            errorCode: input.state === 'succeeded' ? null : (input.providerAttempt.reason ?? input.state),
            errorMessage: null,
            completedAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(agentProviderAttempts.id, attempt.id))
          .returning()
        if (!completed) return 'stale'
        const [settledCost] = await tx
          .update(agentRunCosts)
          .set({
            state: input.state === 'failed_definite' ? 'released' : 'settled',
            accuracy: input.state === 'failed_definite' ? null : publicCost.accuracy,
            settledMicros: publicCost.amountMicros ?? 0,
            minimumMicros: input.state === 'failed_definite' ? null : publicCost.minimumMicros,
            maximumMicros: input.state === 'failed_definite' ? null : publicCost.maximumMicros,
            promptTokens: input.promptTokens ?? null,
            completionTokens: input.completionTokens ?? null,
            decisionOutput: input.decisionOutput ?? null,
            decisionUsage: input.decisionUsage ?? null,
            decisionTrace: input.decisionTrace ?? null,
            updatedAt: input.now,
          })
          .where(eq(agentRunCosts.id, cost.id))
          .returning()
        if (!settledCost) return 'stale'
        const asksUser =
          input.decisionOutput?.output &&
          typeof input.decisionOutput.output === 'object' &&
          !Array.isArray(input.decisionOutput.output) &&
          (input.decisionOutput.output as Record<string, unknown>).action === 'ask_user'
        await tx
          .update(agentRunDispatches)
          .set({ phase: asksUser ? 'waiting_input' : 'executing', updatedAt: input.now })
          .where(eq(agentRunDispatches.id, dispatch.id))
        return {
          attempt: durableProviderAttempt(completed, dispatch.providerIdempotency),
          cost: settledCost as AgentRunCostRecord,
        }
      })
    },
    reconcileAgentProviderAttempt(actorId, dispatchAttempt, now) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.id, dispatchAttempt.dispatchId),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.generation, dispatchAttempt.leaseGeneration),
              eq(agentRunDispatches.leaseOwner, dispatchAttempt.workerId),
            ),
          )
          .for('update')
          .limit(1)
        if (!dispatch || !dispatch.turnId || !dispatch.providerIdempotency) return 'stale'
        const [attempt] = await tx
          .select()
          .from(agentProviderAttempts)
          .where(
            and(
              eq(agentProviderAttempts.actorId, actorId),
              eq(agentProviderAttempts.dispatchId, dispatch.id),
              inArray(agentProviderAttempts.state, ['prepared', 'started']),
            ),
          )
          .orderBy(desc(agentProviderAttempts.attemptNo))
          .for('update')
          .limit(1)
        if (!attempt) return null
        const sameDispatchAttempt =
          attempt.dispatchGeneration === dispatchAttempt.leaseGeneration &&
          attempt.dispatchWorkerId === dispatchAttempt.workerId
        if (sameDispatchAttempt && dispatch.leaseUntil && dispatch.leaseUntil > now && dispatch.state === 'running') {
          return durableProviderAttempt(attempt, dispatch.providerIdempotency)
        }
        const [cost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, dispatch.projectId),
              eq(agentRunCosts.turnId, dispatch.turnId),
            ),
          )
          .for('update')
          .limit(1)
        if (!cost) return 'stale'
        const nextState = attempt.state === 'started' ? 'outcome_unknown' : 'failed_definite'
        const [reconciled] = await tx
          .update(agentProviderAttempts)
          .set({
            state: nextState,
            costAccuracy: nextState === 'outcome_unknown' ? 'billing_indeterminate' : 'estimated',
            amountMicros: nextState === 'outcome_unknown' ? cost.reservedMicros : 0,
            minimumMicros: 0,
            maximumMicros: nextState === 'outcome_unknown' ? cost.reservedMicros : 0,
            errorCode: 'dispatch_attempt_stale',
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(agentProviderAttempts.id, attempt.id))
          .returning()
        if (!reconciled) return 'stale'
        if (nextState === 'outcome_unknown') {
          await tx
            .update(agentRunCosts)
            .set({
              state: 'settled',
              accuracy: 'billing_indeterminate',
              settledMicros: sql`${agentRunCosts.reservedMicros}`,
              minimumMicros: 0,
              maximumMicros: sql`${agentRunCosts.reservedMicros}`,
              updatedAt: now,
            })
            .where(
              and(
                eq(agentRunCosts.actorId, actorId),
                eq(agentRunCosts.projectId, dispatch.projectId),
                eq(agentRunCosts.turnId, dispatch.turnId),
                eq(agentRunCosts.state, 'reserved'),
              ),
            )
        } else {
          await tx
            .update(agentRunCosts)
            .set({
              state: 'released',
              accuracy: null,
              settledMicros: 0,
              minimumMicros: null,
              maximumMicros: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(agentRunCosts.actorId, actorId),
                eq(agentRunCosts.projectId, dispatch.projectId),
                eq(agentRunCosts.turnId, dispatch.turnId),
                eq(agentRunCosts.state, 'reserved'),
              ),
            )
        }
        return durableProviderAttempt(reconciled, dispatch.providerIdempotency)
      })
    },
    respondToAgentTask(actorId, input) {
      return withActor(actorId, async tx => {
        const [membership] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .innerJoin(projects, eq(projects.id, projectMembers.projectId))
          .where(
            and(
              eq(projectMembers.projectId, input.projectId),
              eq(projectMembers.userId, actorId),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        if (!membership) return null
        if (membership.role !== 'owner' && membership.role !== 'editor') return 'forbidden'
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-turn:${input.projectId}:${input.turnId}`}, 0))`,
        )
        const [existing] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, input.projectId),
              eq(agentRunDispatches.turnId, input.turnId),
            ),
          )
          .limit(1)
        if (existing) {
          return existing.taskId === input.taskId &&
            existing.conversationId === input.conversationId &&
            existing.inputSnapshot?.prompt === input.response &&
            existing.inputSnapshot?.responseToQuestionId === input.questionId &&
            Array.isArray(existing.inputSnapshot.responseAttachmentIds) &&
            JSON.stringify(existing.inputSnapshot.responseAttachmentIds) === JSON.stringify(input.attachmentIds)
            ? { dispatch: existing as AgentRunDispatchRecord }
            : 'conflict'
        }

        const [source] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, input.projectId),
              eq(agentRunDispatches.taskId, input.taskId),
              eq(agentRunDispatches.phase, 'waiting_input'),
              eq(agentRunDispatches.state, 'paused'),
              eq(agentRunDispatches.waitingReason, 'user'),
            ),
          )
          .orderBy(desc(agentRunDispatches.createdAt))
          .for('update')
          .limit(1)
        if (
          !source ||
          source.conversationId !== input.conversationId ||
          !source.inputSnapshot ||
          !source.frozenProvider ||
          !source.frozenModel ||
          !source.frozenProfile ||
          !source.frozenConfigDigest ||
          !source.billingScope ||
          !source.payerId ||
          source.taskLimitMicros === null ||
          source.projectLimitMicros === null ||
          source.warningRatio === null ||
          !source.providerIdempotency ||
          typeof source.inputSnapshot.projectDraftVersion !== 'number' ||
          typeof source.inputSnapshot.maximumRateMicrosPerToken !== 'number' ||
          source.inputSnapshot.maximumRateMicrosPerToken <= 0
        ) {
          return 'invalid_question'
        }
        if (!durableProviderInputSnapshot(source.inputSnapshot.providerInputSnapshot)) return 'invalid_question'
        const providerInputSnapshot = durableProviderInputSnapshot(input.providerInputSnapshot)
        if (!providerInputSnapshot) return 'invalid_question'
        const [sourceCost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.turnId, source.turnId ?? ''),
            ),
          )
          .for('update')
          .limit(1)
        const output = sourceCost?.decisionOutput?.output
        const question =
          output && typeof output === 'object' && !Array.isArray(output)
            ? (output as Record<string, unknown>).question
            : null
        if (
          !question ||
          typeof question !== 'object' ||
          Array.isArray(question) ||
          (question as Record<string, unknown>).id !== input.questionId
        ) {
          return 'invalid_question'
        }
        const reservedMicros = Math.ceil(
          estimateAgentProviderInputTokens(providerInputSnapshot) * source.inputSnapshot.maximumRateMicrosPerToken,
        )
        if (reservedMicros !== input.reservedMicros) return 'conflict'
        const chargedMicros = sql<number>`case
          when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
          when ${agentRunCosts.accuracy} = 'billing_indeterminate'
            then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
          else ${agentRunCosts.settledMicros}
        end`
        const [usage] = await tx
          .select({
            taskMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.actorId} = ${actorId}
                and ${agentRunCosts.projectId} = ${input.projectId}
                and ${agentRunCosts.taskId} = ${input.taskId}
                then ${chargedMicros}
              else 0
            end), 0)`,
            projectMonthMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.billingScope} = ${source.billingScope}
                and ${agentRunCosts.payerId} = ${source.payerId}
                and (${source.billingScope} = 'user' or ${agentRunCosts.projectId} = ${input.projectId})
                and ${agentRunCosts.createdAt} >= date_trunc('month', ${input.now} at time zone 'UTC') at time zone 'UTC'
                then ${chargedMicros}
              else 0
            end), 0)`,
          })
          .from(agentRunCosts)
          .where(ne(agentRunCosts.state, 'released'))
        if (Number(usage?.taskMicros ?? 0) + reservedMicros > source.taskLimitMicros) {
          return 'task_budget_exceeded'
        }
        if (Number(usage?.projectMonthMicros ?? 0) + reservedMicros > source.projectLimitMicros) {
          return 'project_budget_exceeded'
        }
        const operationId = `operation-${randomUUID()}`
        const endpoint = typeof source.inputSnapshot.endpoint === 'string' ? source.inputSnapshot.endpoint : null
        if (!endpoint) return 'invalid_question'
        const nextSnapshot = {
          prompt: input.response,
          attachmentIds: [
            ...new Set([
              ...(Array.isArray(source.inputSnapshot.attachmentIds)
                ? source.inputSnapshot.attachmentIds.filter((id): id is string => typeof id === 'string')
                : []),
              ...input.attachmentIds,
            ]),
          ],
          projectContext: Array.isArray(source.inputSnapshot.projectContext)
            ? structuredClone(source.inputSnapshot.projectContext)
            : [],
          endpoint,
          projectDraftVersion: source.inputSnapshot.projectDraftVersion,
          reservedMicros,
          maximumRateMicrosPerToken: source.inputSnapshot.maximumRateMicrosPerToken,
          providerInputSnapshot,
          providerRequestKey: null,
          responseToQuestionId: input.questionId,
          responseAttachmentIds: [...input.attachmentIds],
        }
        const responseDigest = agentRunInputDigest({
          projectId: input.projectId,
          conversationId: source.conversationId,
          taskId: input.taskId,
          turnId: input.turnId,
          prompt: input.response,
          attachmentIds: nextSnapshot.attachmentIds,
          projectContext: nextSnapshot.projectContext.filter(
            (item): item is { title: string; content: string; status: 'confirmed' } =>
              item &&
              typeof item === 'object' &&
              !Array.isArray(item) &&
              item.status === 'confirmed' &&
              typeof item.title === 'string' &&
              typeof item.content === 'string',
          ),
        })
        const [dispatch] = await tx
          .insert(agentRunDispatches)
          .values({
            actorId,
            projectId: input.projectId,
            conversationId: source.conversationId,
            taskId: input.taskId,
            turnId: input.turnId,
            operationId,
            inputDigest: responseDigest,
            inputSnapshot: nextSnapshot,
            phase: 'planning',
            frozenProvider: source.frozenProvider,
            frozenModel: source.frozenModel,
            frozenProfile: source.frozenProfile,
            frozenConfigDigest: source.frozenConfigDigest,
            billingScope: source.billingScope,
            payerId: source.payerId,
            taskLimitMicros: source.taskLimitMicros,
            projectLimitMicros: source.projectLimitMicros,
            warningRatio: source.warningRatio,
            providerIdempotency: source.providerIdempotency,
            kind: 'run',
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning()
        if (!dispatch) throw new Error('Agent response dispatch insert returned no row')
        await tx.insert(agentRunCosts).values({
          actorId,
          projectId: input.projectId,
          taskId: input.taskId,
          turnId: input.turnId,
          inputDigest: responseDigest,
          operationId,
          provider: source.frozenProvider,
          model: source.frozenModel,
          profile: source.frozenProfile,
          state: 'reserved',
          accuracy: null,
          reservedMicros,
          billingScope: source.billingScope,
          payerId: source.payerId,
          reservationExpiresAt: new Date(input.now.getTime() + 10 * 60_000),
          createdAt: input.now,
          updatedAt: input.now,
        })
        await tx
          .update(agentRunDispatches)
          .set({ phase: 'terminal', updatedAt: input.now })
          .where(eq(agentRunDispatches.id, source.id))
        return { dispatch: dispatch as AgentRunDispatchRecord }
      })
    },
    getAgentRunDispatch(actorId, projectId, operationId) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.operationId, operationId),
            ),
          )
          .limit(1)
        return (dispatch as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    getAgentRunDispatchByTask(actorId, projectId, taskId) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.taskId, taskId),
            ),
          )
          .orderBy(desc(agentRunDispatches.createdAt))
          .limit(1)
        return (dispatch as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    async claimAgentRunDispatch(workerId, now, leaseUntil) {
      if (!workerId.trim()) throw new Error('Agent run dispatch worker id is required')
      if (leaseUntil.getTime() <= now.getTime()) throw new Error('Agent run dispatch lease must end after claim time')
      const result = (await db.execute(sql`
        select
          claimed.id,
          claimed.actor_id as "actorId",
          claimed.project_id as "projectId",
          claimed.conversation_id as "conversationId",
          claimed.task_id as "taskId",
          claimed.operation_id as "operationId",
          claimed.kind,
          claimed.waiting_reason as "waitingReason",
          claimed.state,
          claimed.desired_state as "desiredState",
          claimed.generation,
          claimed.lease_owner as "leaseOwner",
          claimed.lease_until as "leaseUntil",
          claimed.heartbeat_at as "heartbeatAt",
          claimed.attempt_count as "attemptCount",
          claimed.error_code as "errorCode",
          claimed.error_message as "errorMessage",
          claimed.created_at as "createdAt",
          claimed.updated_at as "updatedAt",
          claimed.completed_at as "completedAt"
        from app.claim_agent_run_dispatch(${workerId}, ${now}, ${leaseUntil}) as claimed
      `)) as unknown as { rows?: AgentRunDispatchRecord[] }
      return result.rows?.[0] ?? null
    },
    heartbeatAgentRunDispatch(actorId, id, workerId, generation, now, leaseUntil) {
      if (leaseUntil.getTime() <= now.getTime()) throw new Error('Agent run dispatch lease must end after heartbeat')
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(agentRunDispatches)
          .set({
            leaseUntil,
            heartbeatAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(agentRunDispatches.id, id),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.state, 'running'),
              eq(agentRunDispatches.leaseOwner, workerId),
              eq(agentRunDispatches.generation, generation),
              gt(agentRunDispatches.leaseUntil, now),
            ),
          )
          .returning()
        return (updated as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    controlAgentRunDispatch(actorId, projectId, operationId, action, now) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.operationId, operationId),
            ),
          )
          .for('update')
          .limit(1)
        if (!dispatch) return null

        const activeLease =
          dispatch.state === 'running' && dispatch.leaseUntil !== null && dispatch.leaseUntil.getTime() > now.getTime()
        if (action === 'pause' && dispatch.desiredState === 'paused' && activeLease)
          return dispatch as AgentRunDispatchRecord
        if (action === 'resume' && dispatch.desiredState === 'running' && dispatch.state !== 'paused')
          return dispatch as AgentRunDispatchRecord
        if (action === 'cancel' && dispatch.desiredState === 'canceled' && activeLease)
          return dispatch as AgentRunDispatchRecord

        if (['succeeded', 'failed', 'canceled', 'indeterminate'].includes(dispatch.state)) return 'invalid_state'

        let nextState = dispatch.state
        let nextDesiredState = dispatch.desiredState
        let releaseLease = false
        let completedAt = dispatch.completedAt
        let reconciledOperation: AgentSpikeOperationRecord | null | undefined
        if ((action === 'pause' || action === 'cancel') && !activeLease) {
          await lockAgentSpikeOperation(tx, actorId, operationId)
          reconciledOperation = await selectAgentSpikeOperation(tx, actorId, operationId, true)
          if (reconciledOperation && reconciledOperation.projectId !== projectId) return 'invalid_state'
          if (
            action === 'pause' &&
            dispatch.state === 'paused' &&
            dispatch.desiredState === 'paused' &&
            reconciledDispatchState(reconciledOperation?.status ?? null) === null
          ) {
            return dispatch as AgentRunDispatchRecord
          }
        }

        if (action === 'pause') {
          nextDesiredState = 'paused'
          if (dispatch.state !== 'running' || !activeLease) {
            nextState = reconciledDispatchState(reconciledOperation?.status ?? null) ?? 'paused'
            releaseLease = true
            completedAt = nextState === 'paused' ? null : now
          }
        } else if (action === 'resume') {
          nextDesiredState = 'running'
          if (dispatch.state === 'paused') {
            nextState = 'queued'
            releaseLease = true
          }
        } else {
          nextDesiredState = 'canceled'
          if (dispatch.state !== 'running' || !activeLease) {
            const operation = reconciledOperation
            const terminalState = reconciledDispatchState(operation?.status ?? null)
            if (terminalState) {
              nextState = terminalState
              releaseLease = true
              completedAt = now
            } else if (operation) {
              await tx
                .update(agentSpikeOperations)
                .set({
                  status: 'failed_not_applied',
                  outcome: { status: 'failed_not_applied', reason: 'user_canceled' },
                  completedAt: now,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(agentSpikeOperations.id, operation.id),
                    inArray(agentSpikeOperations.status, ['issued', 'prepared']),
                  ),
                )
              nextState = 'canceled'
              releaseLease = true
              completedAt = now
            } else {
              nextState = 'indeterminate'
              releaseLease = true
              completedAt = now
            }
          }
        }

        const [updated] = await tx
          .update(agentRunDispatches)
          .set({
            state: nextState,
            desiredState: nextDesiredState,
            leaseOwner: releaseLease ? null : dispatch.leaseOwner,
            leaseUntil: releaseLease ? null : dispatch.leaseUntil,
            completedAt,
            ...(nextState === 'indeterminate'
              ? {
                  errorCode: 'operation_state_indeterminate',
                  errorMessage: 'Durable operation state could not be reconciled',
                }
              : {}),
            ...(action === 'resume' ? { errorCode: null, errorMessage: null } : {}),
            ...(action === 'resume' ? { waitingReason: null } : {}),
            updatedAt: now,
          })
          .where(eq(agentRunDispatches.id, dispatch.id))
          .returning()
        return (updated as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    finalizeAgentRunAttachments(actorId, projectId, operationId, now) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.operationId, operationId),
            ),
          )
          .for('update')
          .limit(1)
        if (!dispatch) return null

        const waitingForInitialUpload =
          dispatch.kind === 'initial' &&
          dispatch.state === 'paused' &&
          dispatch.desiredState === 'paused' &&
          dispatch.waitingReason === 'upload'
        if (!waitingForInitialUpload) {
          return { dispatch: dispatch as AgentRunDispatchRecord, transitioned: false }
        }

        const [updated] = await tx
          .update(agentRunDispatches)
          .set({
            state: 'queued',
            desiredState: 'running',
            waitingReason: null,
            leaseOwner: null,
            leaseUntil: null,
            heartbeatAt: null,
            errorCode: null,
            errorMessage: null,
            completedAt: null,
            updatedAt: now,
          })
          .where(eq(agentRunDispatches.id, dispatch.id))
          .returning()
        if (!updated) return null
        return { dispatch: updated as AgentRunDispatchRecord, transitioned: true }
      })
    },
    markAgentRunDispatchWaiting(actorId, projectId, operationId, reason, now) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(agentRunDispatches)
          .set({
            state: 'paused',
            desiredState: 'paused',
            waitingReason: reason,
            errorCode: reason === 'user' ? 'waiting_user' : null,
            errorMessage: reason === 'user' ? '等待用户补充信息' : null,
            updatedAt: now,
          })
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.operationId, operationId),
              eq(agentRunDispatches.kind, 'initial'),
              eq(agentRunDispatches.state, 'paused'),
            ),
          )
          .returning()
        return (updated as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    validateAgentRunDispatchAttempt(actorId, projectId, operationId, attempt, now) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select({ id: agentRunDispatches.id })
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.id, attempt.dispatchId),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.operationId, operationId),
              eq(agentRunDispatches.state, 'running'),
              eq(agentRunDispatches.desiredState, 'running'),
              eq(agentRunDispatches.leaseOwner, attempt.workerId),
              eq(agentRunDispatches.generation, attempt.leaseGeneration),
              gt(agentRunDispatches.leaseUntil, now),
            ),
          )
          .limit(1)
        return Boolean(dispatch)
      })
    },
    finishAgentRunDispatch(actorId, id, workerId, generation, state, error, now) {
      return withActor(actorId, async tx => {
        const [finished] = await tx
          .update(agentRunDispatches)
          .set({
            state,
            ...(state === 'paused'
              ? { desiredState: 'paused' as const }
              : state === 'canceled'
                ? { desiredState: 'canceled' as const }
                : {}),
            leaseOwner: null,
            leaseUntil: null,
            heartbeatAt: now,
            errorCode: error?.code ?? null,
            errorMessage: error?.message ?? null,
            waitingReason: state === 'paused' && error?.code === 'waiting_user' ? 'user' : null,
            completedAt: state === 'paused' ? null : now,
            updatedAt: now,
          })
          .where(
            and(
              eq(agentRunDispatches.id, id),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.state, 'running'),
              eq(agentRunDispatches.leaseOwner, workerId),
              eq(agentRunDispatches.generation, generation),
              gt(agentRunDispatches.leaseUntil, now),
            ),
          )
          .returning()
        return (finished as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    getAgentRunCost(actorId, projectId, taskId) {
      return withActor(actorId, async tx => {
        const costs = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.taskId, taskId),
            ),
          )
          .orderBy(desc(agentRunCosts.createdAt), desc(agentRunCosts.id))
        return aggregateAgentRunCostRows(costs as AgentRunCostRecord[])
      })
    },
    getAgentRunCostByTurn(actorId, projectId, turnId) {
      return withActor(actorId, async tx => {
        const [cost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.turnId, turnId),
            ),
          )
          .limit(1)
        return (cost as AgentRunCostRecord | undefined) ?? null
      })
    },
    reconcileAgentRunCost(actorId, projectId, taskId, now) {
      return withActor(actorId, async tx => {
        await tx.execute(sql`
          update app.agent_run_costs as cost
          set state = 'settled',
              accuracy = 'billing_indeterminate',
              settled_micros = cost.reserved_micros,
              minimum_micros = 0,
              maximum_micros = cost.reserved_micros,
              updated_at = ${now}
          where cost.actor_id = ${actorId}
            and cost.project_id = ${projectId}
            and cost.task_id = ${taskId}
            and cost.state = 'reserved'
            and cost.reservation_expires_at <= ${now}
            and exists (
              select 1
              from app.agent_run_dispatches as dispatch
              join app.agent_provider_attempts as attempt on attempt.dispatch_id = dispatch.id
              where dispatch.actor_id = cost.actor_id
                and dispatch.project_id = cost.project_id
                and dispatch.turn_id = cost.turn_id
                and attempt.attempt_no = (
                  select max(latest.attempt_no)
                  from app.agent_provider_attempts as latest
                  where latest.dispatch_id = dispatch.id
                )
                and attempt.state in ('started', 'outcome_unknown')
            )
        `)
        await tx
          .update(agentRunCosts)
          .set({
            state: 'released',
            accuracy: null,
            settledMicros: 0,
            minimumMicros: null,
            maximumMicros: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.taskId, taskId),
              eq(agentRunCosts.state, 'reserved'),
              lte(agentRunCosts.reservationExpiresAt, now),
            ),
          )
        const costs = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.taskId, taskId),
            ),
          )
          .orderBy(desc(agentRunCosts.createdAt), desc(agentRunCosts.id))
        return aggregateAgentRunCostRows(costs as AgentRunCostRecord[])
      })
    },
    failAgentSpikeOperation(actorId, binding, outcome) {
      return withActor(actorId, async tx => {
        await lockAgentSpikeOperation(tx, actorId, binding.operationId)
        const operation = await selectAgentSpikeOperation(tx, actorId, binding.operationId, true)
        if (!operation) return null
        if (!agentSpikeBindingMatches(operation, binding)) return 'integrity_conflict'
        if (operation.status === 'committed' || operation.status === 'rejected_stale') return operation
        if (operation.status === 'failed_not_applied' || operation.status === 'indeterminate') return operation
        if (operation.status !== 'issued' && operation.status !== 'prepared') return 'invalid_state'
        const completedAt = new Date()
        const [failed] = await tx
          .update(agentSpikeOperations)
          .set({
            status: 'failed_not_applied',
            outcome: { ...outcome, status: 'failed_not_applied' },
            completedAt,
            updatedAt: completedAt,
          })
          .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, operation.status)))
          .returning()
        return failed ?? 'invalid_state'
      })
    },
    async undoAgentSpikeOperation(actorId, projectId, operationId) {
      try {
        return await withActor(actorId, async tx => {
          await lockAgentSpikeOperation(tx, actorId, operationId)
          const operation = await selectAgentSpikeOperation(tx, actorId, operationId, true)
          if (!operation || operation.projectId !== projectId) return null
          if (operation.rolledBackAt && operation.rollbackReceipt) {
            const currentProject = await selectProjectDetail(tx, actorId, projectId)
            if (!currentProject) return null
            return {
              project: currentProject,
              rolledBackAt: operation.rolledBackAt,
              receipt: operation.rollbackReceipt,
            }
          }
          if (
            operation.status !== 'committed' ||
            !operation.rollbackRevisionId ||
            operation.committedDraftVersion === null ||
            !operation.candidateSchema
          ) {
            return 'invalid_state'
          }
          const [project] = await tx
            .select({ draftVersion: projects.draftVersion, draftSchema: projects.draftSchema })
            .from(projects)
            .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
            .for('update')
            .limit(1)
          if (!project) return null
          const [rollback] = await tx
            .select({ schema: projectRevisions.schema })
            .from(projectRevisions)
            .where(
              and(
                eq(projectRevisions.id, operation.rollbackRevisionId),
                eq(projectRevisions.projectId, projectId),
                eq(projectRevisions.kind, 'agent'),
              ),
            )
            .limit(1)
          if (!rollback) return 'invalid_state'
          const undo = safeAgentUndo(rollback.schema, operation.candidateSchema, project.draftSchema)
          if (!undo.ok) return 'conflict'

          const restoredAt = new Date()
          await insertRevision(tx, {
            actorId,
            projectId,
            schema: project.draftSchema,
            kind: 'pre_restore',
            sourceDraftVersion: project.draftVersion,
            label: `撤销 Agent 执行 · ${operation.taskId}`.slice(0, 120),
          })
          const nextDraftVersion = project.draftVersion + 1
          const [restored] = await tx
            .update(projects)
            .set({
              draftSchema: undo.schema,
              draftVersion: nextDraftVersion,
              draftSavedAt: restoredAt,
              ...projectMetadata(undo.schema),
              thumbnailStatus: sql`case
                when ${projects.thumbnailMode} = 'auto' then 'queued'
                when ${projects.thumbnailPath} is not null then 'ready'
                else 'failed'
              end`,
              thumbnailRequestedVersion: thumbnailRequestedVersionCase(nextDraftVersion),
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
              thumbnailErrorCode: sql`case
                when ${projects.thumbnailMode} = 'auto' then null
                when ${projects.thumbnailPath} is not null then null
                else 'draft-version-changed'
              end`,
              updatedAt: restoredAt,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                eq(projects.draftVersion, project.draftVersion),
                isNull(projects.deletedAt),
              ),
            )
            .returning({ id: projects.id })
          if (!restored) throw new AgentUndoConflictRollback()
          const receipt = {
            receiptVersion: 'easy-dashboard.agent-undo-receipt.v2',
            operationId,
            rollbackRevisionId: operation.rollbackRevisionId,
            revertedPaths: undo.revertedPaths,
            sourceCommittedDraftVersion: operation.committedDraftVersion,
            preUndoDraftVersion: project.draftVersion,
            restoredDraftVersion: nextDraftVersion,
          }
          const [recorded] = await tx
            .update(agentSpikeOperations)
            .set({ rolledBackAt: restoredAt, rollbackReceipt: receipt, updatedAt: restoredAt })
            .where(and(eq(agentSpikeOperations.id, operation.id), isNull(agentSpikeOperations.rolledBackAt)))
            .returning({ rolledBackAt: agentSpikeOperations.rolledBackAt })
          if (!recorded?.rolledBackAt) throw new Error('Agent undo receipt was not persisted')
          const restoredProject = await selectProjectDetail(tx, actorId, projectId)
          if (!restoredProject) throw new Error('Undone Agent project could not be read')
          return { project: restoredProject, rolledBackAt: recorded.rolledBackAt, receipt }
        })
      } catch (error) {
        if (error instanceof AgentUndoConflictRollback) return 'conflict'
        throw error
      }
    },
    updateProject(actorId, projectId, input) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projects)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .returning({ id: projects.id })
        return updated ? selectProjectDetail(tx, actorId, projectId) : null
      })
    },
    setProjectFavorite(actorId, projectId, isFavorite) {
      return withActor(actorId, async tx => {
        const [visible] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!visible) return null
        if (isFavorite) {
          await tx
            .insert(projectFavorites)
            .values({ projectId, userId: actorId })
            .onConflictDoNothing({ target: [projectFavorites.projectId, projectFavorites.userId] })
        } else {
          await tx
            .delete(projectFavorites)
            .where(and(eq(projectFavorites.projectId, projectId), eq(projectFavorites.userId, actorId)))
        }
        const [project] = await tx
          .select(projectSummarySelection(actorId))
          .from(projects)
          .leftJoin(
            projectPublications,
            and(eq(projectPublications.projectId, projects.id), eq(projectPublications.isPublished, true)),
          )
          .leftJoin(
            projectReleases,
            and(
              eq(projectReleases.projectId, projects.id),
              eq(projectReleases.revisionId, projectPublications.revisionId),
            ),
          )
          .where(eq(projects.id, projectId))
          .limit(1)
        return project ?? null
      })
    },
    duplicateProject(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [source] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!source) return null
        const spaceId = await ensurePersonalSpaceWithTx(tx, actorId)
        const copyId = randomUUID()
        await tx.insert(projects).values({
          id: copyId,
          ownerId: actorId,
          spaceId,
          name: `${source.name} copy`.slice(0, 120),
          description: source.description,
          coverUrl: source.coverUrl,
          draftSchema: source.draftSchema,
          ...projectMetadata(source.draftSchema),
        })
        await insertProjectOwnerMembership(tx, copyId, actorId)
        return selectProjectDetail(tx, actorId, copyId)
      })
    },
    async trashProject(actorId, accessToken, projectId) {
      const trashed = await withActor(actorId, async tx => {
        const now = new Date()
        const [project] = await tx
          .update(projects)
          .set({
            deletedAt: now,
            thumbnailPath: null,
            thumbnailUrl: null,
            thumbnailDraftVersion: null,
            thumbnailStatus: 'queued',
            thumbnailErrorCode: null,
            thumbnailRequestedVersion: null,
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            updatedAt: now,
          })
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .returning({ id: projects.id })
        if (!project) return false
        await tx
          .update(projectThumbnailArtifacts)
          .set({
            status: 'cleanup_pending',
            nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, ${now})`,
            updatedAt: now,
          })
          .where(
            and(eq(projectThumbnailArtifacts.projectId, projectId), ne(projectThumbnailArtifacts.status, 'deleted')),
          )
        await tx
          .update(projectPublications)
          .set({ isPublished: false, updatedAt: now })
          .where(eq(projectPublications.projectId, projectId))
        return true
      })
      if (trashed) await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      return trashed
    },
    async permanentlyDeleteProject(actorId, accessToken, projectId) {
      const state = await withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            deletedAt: projects.deletedAt,
            permanentDeleteToken: projects.permanentDeleteToken,
          })
          .from(projects)
          .where(and(eq(projects.id, projectId), canOwnProject(actorId)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (!project.deletedAt) return 'conflict' as const
        const deleteToken = project.permanentDeleteToken ?? randomUUID()
        const prepared = (await tx.execute(sql`
          select storage_path
          from app.prepare_project_agent_asset_cleanup(${projectId}, ${project.deletedAt}, ${deleteToken})
        `)) as unknown as { rows?: Array<{ storage_path?: unknown }> }
        const assetPaths = (prepared.rows ?? []).flatMap(row =>
          typeof row.storage_path === 'string' ? [row.storage_path] : [],
        )
        return { deletedAt: project.deletedAt, deleteToken, assetPaths }
      })
      if (state === null || state === 'conflict') return state

      const finishAgentAssetCleanup = async (succeeded: boolean, failureMessage: string | null) =>
        withActor(actorId, async tx => {
          const result = (await tx.execute(sql`
            select app.finish_project_agent_asset_cleanup(
              ${projectId},
              ${state.deletedAt},
              ${state.deleteToken},
              ${succeeded},
              ${failureMessage}
            ) as finished
          `)) as unknown as { rows?: Array<{ finished?: unknown }> }
          return result.rows?.[0]?.finished === true
        })

      // The owner-only cleanup policy can remove every collaborator-owned
      // object only after the security-definer preparation function has
      // tombstoned and scrubbed the complete project ledger. Partial batches
      // are safe to retry because Storage deletion is idempotent and the
      // project row is retained until settlement succeeds.
      for (let index = 0; index < state.assetPaths.length; index += 100) {
        const { error } = await agentAssetStorage(accessToken).remove(state.assetPaths.slice(index, index + 100))
        if (error) {
          await finishAgentAssetCleanup(
            false,
            (error.message || 'Unable to delete project Agent assets').slice(0, 1000),
          ).catch(() => false)
          throw new Error(error.message || 'Unable to delete project Agent assets')
        }
      }
      if (!(await finishAgentAssetCleanup(true, null))) return 'conflict'

      // Trash already clears project thumbnail references. Reconciliation
      // preserves signed-upload expiry guarantees, marks the remaining ledger
      // rows for cleanup, and makes a best-effort storage deletion before the
      // project aggregate is removed.
      await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)

      return withActor(actorId, async tx => {
        const [deleted] = await tx
          .delete(projects)
          .where(
            and(
              eq(projects.id, projectId),
              canOwnProject(actorId),
              eq(projects.deletedAt, state.deletedAt),
              eq(projects.permanentDeleteToken, state.deleteToken),
            ),
          )
          .returning({ id: projects.id })
        if (deleted) return true

        const [existing] = await tx
          .select({ id: projects.id, deletedAt: projects.deletedAt })
          .from(projects)
          .where(and(eq(projects.id, projectId), canOwnProject(actorId)))
          .limit(1)
        return existing ? ('conflict' as const) : null
      })
    },
    restoreProject(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projects)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(projects.id, projectId),
              canEditProject(actorId),
              isNotNull(projects.deletedAt),
              isNull(projects.permanentDeleteToken),
            ),
          )
          .returning({ id: projects.id })
        if (updated) return selectProjectDetail(tx, actorId, projectId)

        const [deleting] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, projectId),
              canEditProject(actorId),
              isNotNull(projects.deletedAt),
              isNotNull(projects.permanentDeleteToken),
            ),
          )
          .limit(1)
        return deleting ? ('deletion_in_progress' as const) : null
      })
    },
    saveDraft(actorId, projectId, expectedVersion, draftSchema) {
      return withActor(actorId, async tx => {
        const savedAt = new Date()
        const [updated] = await tx
          .update(projects)
          .set({
            draftSchema,
            draftVersion: expectedVersion + 1,
            draftSavedAt: savedAt,
            ...projectMetadata(draftSchema),
            thumbnailStatus: sql`case
              when ${projects.thumbnailMode} = 'auto' then 'queued'
              when ${projects.thumbnailPath} is not null then 'ready'
              else 'failed'
            end`,
            thumbnailRequestedVersion: thumbnailRequestedVersionCase(expectedVersion + 1),
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            thumbnailErrorCode: sql`case
              when ${projects.thumbnailMode} = 'auto' then null
              when ${projects.thumbnailPath} is not null then null
              else 'draft-version-changed'
            end`,
            updatedAt: savedAt,
          })
          .where(
            and(
              eq(projects.id, projectId),
              canEditProject(actorId),
              eq(projects.draftVersion, expectedVersion),
              isNull(projects.deletedAt),
            ),
          )
          .returning()
        if (updated) {
          const [latestAuto] = await tx
            .select({ createdAt: projectRevisions.createdAt })
            .from(projectRevisions)
            .where(and(eq(projectRevisions.projectId, projectId), eq(projectRevisions.kind, 'auto')))
            .orderBy(desc(projectRevisions.createdAt))
            .limit(1)
          if (!latestAuto || savedAt.getTime() - latestAuto.createdAt.getTime() >= 5 * 60 * 1000) {
            await insertRevision(tx, {
              actorId,
              projectId,
              schema: draftSchema,
              kind: 'auto',
              sourceDraftVersion: expectedVersion + 1,
            })
          }
          const project = await selectProjectDetail(tx, actorId, projectId)
          if (!project) throw new Error('Saved project could not be read')
          return project
        }
        const [existing] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        return existing ? 'conflict' : null
      })
    },
    listRevisions(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [owned] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!owned) return null
        return tx
          .select({
            id: projectRevisions.id,
            projectId: projectRevisions.projectId,
            revisionNumber: projectRevisions.revisionNumber,
            kind: projectRevisions.kind,
            label: projectRevisions.label,
            sourceDraftVersion: projectRevisions.sourceDraftVersion,
            schema: projectRevisions.schema,
            createdAt: projectRevisions.createdAt,
          })
          .from(projectRevisions)
          .where(and(eq(projectRevisions.projectId, projectId), ne(projectRevisions.kind, 'publish')))
          .orderBy(desc(projectRevisions.revisionNumber))
      })
    },
    listReleases(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [visible] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId)))
          .limit(1)
        if (!visible) return null
        return tx
          .select({
            projectId: projectReleases.projectId,
            releaseNumber: projectReleases.releaseNumber,
            revisionId: projectReleases.revisionId,
            revisionNumber: projectRevisions.revisionNumber,
            name: projectReleases.name,
            description: projectReleases.description,
            publishedAt: projectReleases.publishedAt,
            slug: projectPublications.slug,
            isCurrent: sql<boolean>`${projectPublications.revisionId} = ${projectReleases.revisionId}`,
            isPublished: sql<boolean>`coalesce(${projectPublications.isPublished}, false)`,
          })
          .from(projectReleases)
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectReleases.revisionId))
          .leftJoin(projectPublications, eq(projectPublications.projectId, projectReleases.projectId))
          .where(eq(projectReleases.projectId, projectId))
          .orderBy(desc(projectReleases.releaseNumber))
      })
    },
    createRestorePoint(actorId, projectId, kind, label) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            draftSchema: projects.draftSchema,
            draftVersion: projects.draftVersion,
          })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        return insertRevision(tx, {
          actorId,
          projectId,
          schema: project.draftSchema,
          kind,
          sourceDraftVersion: project.draftVersion,
          label,
        })
      })
    },
    restoreRevision(actorId, projectId, revisionId, expectedVersion) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (project.draftVersion !== expectedVersion) return 'conflict'
        const [revision] = await tx
          .select({ schema: projectRevisions.schema })
          .from(projectRevisions)
          .where(
            and(
              eq(projectRevisions.id, revisionId),
              eq(projectRevisions.projectId, projectId),
              ne(projectRevisions.kind, 'publish'),
            ),
          )
          .limit(1)
        if (!revision) return null
        await insertRevision(tx, {
          actorId,
          projectId,
          schema: project.draftSchema,
          kind: 'pre_restore',
          sourceDraftVersion: project.draftVersion,
        })
        const [restored] = await tx
          .update(projects)
          .set({
            draftSchema: revision.schema,
            draftVersion: expectedVersion + 1,
            draftSavedAt: new Date(),
            ...projectMetadata(revision.schema),
            thumbnailStatus: sql`case
              when ${projects.thumbnailMode} = 'auto' then 'queued'
              when ${projects.thumbnailPath} is not null then 'ready'
              else 'failed'
            end`,
            thumbnailRequestedVersion: thumbnailRequestedVersionCase(expectedVersion + 1),
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            thumbnailErrorCode: sql`case
              when ${projects.thumbnailMode} = 'auto' then null
              when ${projects.thumbnailPath} is not null then null
              else 'draft-version-changed'
            end`,
            updatedAt: new Date(),
          })
          .where(and(eq(projects.id, projectId), eq(projects.draftVersion, expectedVersion)))
          .returning({ id: projects.id })
        if (!restored) return 'conflict'
        const detail = await selectProjectDetail(tx, actorId, projectId)
        if (!detail) throw new Error('Restored project could not be read')
        return detail
      })
    },
    restoreRelease(actorId, projectId, releaseNumber, expectedVersion) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (project.draftVersion !== expectedVersion) return 'conflict'

        const [release] = await tx
          .select({ schema: projectRevisions.schema })
          .from(projectReleases)
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectReleases.revisionId))
          .where(
            and(
              eq(projectReleases.projectId, projectId),
              eq(projectReleases.releaseNumber, releaseNumber),
              eq(projectRevisions.projectId, projectId),
              eq(projectRevisions.kind, 'publish'),
            ),
          )
          .limit(1)
        if (!release) return null

        await insertRevision(tx, {
          actorId,
          projectId,
          schema: project.draftSchema,
          kind: 'pre_restore',
          sourceDraftVersion: project.draftVersion,
        })
        const savedAt = new Date()
        const [restored] = await tx
          .update(projects)
          .set({
            draftSchema: release.schema,
            draftVersion: expectedVersion + 1,
            draftSavedAt: savedAt,
            ...projectMetadata(release.schema),
            thumbnailStatus: sql`case
              when ${projects.thumbnailMode} = 'auto' then 'queued'
              when ${projects.thumbnailPath} is not null then 'ready'
              else 'failed'
            end`,
            thumbnailRequestedVersion: thumbnailRequestedVersionCase(expectedVersion + 1),
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            thumbnailErrorCode: sql`case
              when ${projects.thumbnailMode} = 'auto' then null
              when ${projects.thumbnailPath} is not null then null
              else 'draft-version-changed'
            end`,
            updatedAt: savedAt,
          })
          .where(and(eq(projects.id, projectId), eq(projects.draftVersion, expectedVersion)))
          .returning({ id: projects.id })
        if (!restored) return 'conflict'

        const detail = await selectProjectDetail(tx, actorId, projectId)
        if (!detail) throw new Error('Restored release draft could not be read')
        return detail
      })
    },
    createPublishSnapshot(actorId, projectId, draftVersion) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            draftSchema: projects.draftSchema,
            draftVersion: projects.draftVersion,
          })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (project.draftVersion !== draftVersion) return 'conflict'

        const documentSha256 = canonicalJsonSha256(project.draftSchema)
        const inserted = await tx
          .insert(projectPublishSnapshots)
          .values({
            projectId,
            draftVersion,
            document: project.draftSchema,
            documentSha256,
            createdBy: actorId,
          })
          .onConflictDoNothing()
          .returning()
        const [snapshot] = inserted.length
          ? inserted
          : await tx
              .select()
              .from(projectPublishSnapshots)
              .where(
                and(
                  eq(projectPublishSnapshots.projectId, projectId),
                  eq(projectPublishSnapshots.draftVersion, draftVersion),
                ),
              )
              .limit(1)
        if (!snapshot) throw new Error('Publish snapshot insert returned no row')
        if (snapshot.documentSha256 !== documentSha256) return 'conflict'

        const [existingPreview] = await tx
          .select()
          .from(projectPreviewRuns)
          .where(eq(projectPreviewRuns.publishSnapshotId, snapshot.id))
          .limit(1)
        if (existingPreview) return { snapshot, previewRun: existingPreview }

        const [operation] = await tx
          .select({
            id: agentSpikeOperations.id,
            compatibility: agentSpikeOperations.compatibility,
            evidence: agentSpikeOperations.evidence,
          })
          .from(agentSpikeOperations)
          .where(
            and(
              eq(agentSpikeOperations.projectId, projectId),
              eq(agentSpikeOperations.status, 'committed'),
              eq(agentSpikeOperations.candidateDigest, documentSha256),
            ),
          )
          .orderBy(desc(agentSpikeOperations.completedAt))
          .limit(1)
        const rendererVersion = operation?.compatibility.rendererVersion
        const rendererSha256 = operation?.compatibility.rendererSha256
        if (
          operation &&
          cleanAgentPreviewEvidence(operation.evidence) &&
          typeof rendererVersion === 'string' &&
          typeof rendererSha256 === 'string' &&
          /^[a-f0-9]{64}$/.test(rendererSha256)
        ) {
          const [previewRun] = await tx
            .insert(projectPreviewRuns)
            .values({
              projectId,
              publishSnapshotId: snapshot.id,
              source: 'agent_executor',
              status: 'verified',
              documentSha256,
              rendererVersion,
              rendererSha256,
              evidence: operation.evidence ?? {},
              agentOperationId: operation.id,
              createdBy: actorId,
            })
            .returning()
          if (!previewRun) throw new Error('Agent preview evidence insert returned no row')
          return { snapshot, previewRun }
        }
        return { snapshot, previewRun: null }
      })
    },
    approvePublishSnapshot(actorId, projectId, snapshotId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id, isOwner: canOwnProject(actorId) })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        if (!project.isOwner) return 'forbidden'
        const [previewRun] = await tx
          .select()
          .from(projectPreviewRuns)
          .where(
            and(
              eq(projectPreviewRuns.projectId, projectId),
              eq(projectPreviewRuns.publishSnapshotId, snapshotId),
              eq(projectPreviewRuns.status, 'verified'),
              eq(projectPreviewRuns.source, 'agent_executor'),
            ),
          )
          .limit(1)
        if (!previewRun) return 'preview_required'
        const inserted = await tx
          .insert(projectPublishApprovals)
          .values({
            projectId,
            publishSnapshotId: snapshotId,
            previewRunId: previewRun.id,
            approvedBy: actorId,
          })
          .onConflictDoNothing()
          .returning()
        const [approval] = inserted.length
          ? inserted
          : await tx
              .select()
              .from(projectPublishApprovals)
              .where(eq(projectPublishApprovals.publishSnapshotId, snapshotId))
              .limit(1)
        if (!approval) throw new Error('Publish approval insert returned no row')
        return approval
      })
    },
    publish(actorId, projectId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            ownerId: projects.ownerId,
            name: projects.name,
            description: projects.description,
            isOwner: canOwnProject(actorId),
          })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (!project.isOwner) return 'forbidden'

        const [existingRelease] = await tx
          .select({
            releaseNumber: projectReleases.releaseNumber,
            revisionId: projectReleases.revisionId,
            revisionNumber: projectRevisions.revisionNumber,
            document: projectPublishSnapshots.document,
            name: projectReleases.name,
            description: projectReleases.description,
            publishedAt: projectReleases.publishedAt,
            slug: projectPublications.slug,
            publicationRevisionId: projectPublications.revisionId,
            publicationIsPublished: projectPublications.isPublished,
          })
          .from(projectReleases)
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectReleases.revisionId))
          .innerJoin(projectPublishSnapshots, eq(projectPublishSnapshots.id, projectReleases.publishSnapshotId))
          .leftJoin(projectPublications, eq(projectPublications.projectId, projectReleases.projectId))
          .where(and(eq(projectReleases.projectId, projectId), eq(projectReleases.publishSnapshotId, input.snapshotId)))
          .limit(1)
        if (existingRelease?.slug) {
          return {
            ...toPublicProject({
              slug: existingRelease.slug,
              projectId,
              name: existingRelease.name,
              description: existingRelease.description,
              revisionId: existingRelease.revisionId,
              revisionNumber: existingRelease.revisionNumber,
              releaseNumber: existingRelease.releaseNumber,
              schema: existingRelease.document,
              publishedAt: existingRelease.publishedAt,
            }),
            isCurrent: existingRelease.publicationRevisionId === existingRelease.revisionId,
            isPublished:
              existingRelease.publicationRevisionId === existingRelease.revisionId &&
              existingRelease.publicationIsPublished === true,
          }
        }

        const [approval] = await tx
          .select({ id: projectPublishApprovals.id, previewRunId: projectPublishApprovals.previewRunId })
          .from(projectPublishApprovals)
          .where(
            and(
              eq(projectPublishApprovals.publishSnapshotId, input.snapshotId),
              eq(projectPublishApprovals.projectId, projectId),
              isNull(projectPublishApprovals.consumedAt),
            ),
          )
          .for('update')
          .limit(1)
        if (!approval) return 'approval_required'

        const [gate] = await tx
          .select({ snapshot: projectPublishSnapshots })
          .from(projectPublishSnapshots)
          .innerJoin(projectPreviewRuns, eq(projectPreviewRuns.id, approval.previewRunId))
          .where(
            and(
              eq(projectPublishSnapshots.id, input.snapshotId),
              eq(projectPublishSnapshots.projectId, projectId),
              eq(projectPreviewRuns.status, 'verified'),
              eq(projectPreviewRuns.documentSha256, projectPublishSnapshots.documentSha256),
              eq(projectPreviewRuns.source, 'agent_executor'),
            ),
          )
          .limit(1)
        if (!gate) return 'approval_required'

        const revision = await insertRevision(tx, {
          actorId,
          projectId,
          schema: gate.snapshot.document,
          kind: 'publish',
          sourceDraftVersion: gate.snapshot.draftVersion,
        })
        const [latestRelease] = await tx
          .select({ value: max(projectReleases.releaseNumber) })
          .from(projectReleases)
          .where(eq(projectReleases.projectId, projectId))
        const releaseNumber = (latestRelease?.value ?? 0) + 1
        const [release] = await tx
          .insert(projectReleases)
          .values({
            projectId,
            releaseNumber,
            revisionId: revision.id,
            name: project.name,
            description: project.description,
            publishedBy: actorId,
            publishSnapshotId: gate.snapshot.id,
          })
          .returning()
        if (!release) throw new Error('Release insert returned no row')

        const [existingPublication] = await tx
          .select({ slug: projectPublications.slug })
          .from(projectPublications)
          .where(eq(projectPublications.projectId, projectId))
          .limit(1)
        const slug = existingPublication?.slug ?? slugify(project.name, project.id)
        const [publication] = await tx
          .insert(projectPublications)
          .values({ projectId, ownerId: project.ownerId, revisionId: revision.id, slug })
          .onConflictDoUpdate({
            target: projectPublications.projectId,
            set: {
              revisionId: revision.id,
              isPublished: true,
              publishedAt: release.publishedAt,
              updatedAt: release.publishedAt,
            },
          })
          .returning()
        if (!publication) throw new Error('Publication upsert returned no row')
        const consumed = await tx
          .update(projectPublishApprovals)
          .set({ consumedAt: release.publishedAt, consumedReleaseId: release.id })
          .where(and(eq(projectPublishApprovals.id, approval.id), isNull(projectPublishApprovals.consumedAt)))
          .returning({ id: projectPublishApprovals.id })
        if (consumed.length !== 1) throw new Error('Publish approval was not consumed exactly once')
        return {
          ...toPublicProject({
            slug: publication.slug,
            projectId: project.id,
            name: release.name,
            description: release.description,
            revisionId: revision.id,
            revisionNumber: revision.revisionNumber,
            releaseNumber: release.releaseNumber,
            schema: revision.schema,
            publishedAt: release.publishedAt,
          }),
          isCurrent: true,
          isPublished: true,
        }
      })
    },
    unpublish(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id, isOwner: canOwnProject(actorId) })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId)))
          .for('update')
          .limit(1)
        if (!project) return false
        if (!project.isOwner) return 'forbidden'

        const removed = await tx
          .update(projectPublications)
          .set({ isPublished: false, updatedAt: new Date() })
          .where(and(eq(projectPublications.projectId, projectId), eq(projectPublications.isPublished, true)))
          .returning({ projectId: projectPublications.projectId })
        return removed.length > 0
      })
    },
    async isPublicProjectAvailable(slug, releaseNumber) {
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.public_slug', ${slug}, true)`)
        let query = tx
          .select({ projectId: projects.id })
          .from(projectPublications)
          .innerJoin(projects, eq(projects.id, projectPublications.projectId))

        if (releaseNumber !== undefined) {
          query = query.innerJoin(projectReleases, eq(projectReleases.projectId, projects.id))
        }

        const [row] = await query
          .where(
            and(
              eq(projectPublications.slug, slug),
              eq(projectPublications.isPublished, true),
              releaseNumber === undefined ? undefined : eq(projectReleases.releaseNumber, releaseNumber),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return Boolean(row)
      })
    },
    async getPublicProject(slug) {
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.public_slug', ${slug}, true)`)
        const [row] = await tx
          .select({
            slug: projectPublications.slug,
            projectId: projects.id,
            name: projectReleases.name,
            description: projectReleases.description,
            revisionId: projectRevisions.id,
            revisionNumber: projectRevisions.revisionNumber,
            releaseNumber: projectReleases.releaseNumber,
            schema: projectRevisions.schema,
            publishedAt: projectReleases.publishedAt,
          })
          .from(projectPublications)
          .innerJoin(projects, eq(projects.id, projectPublications.projectId))
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectPublications.revisionId))
          .innerJoin(projectReleases, eq(projectReleases.revisionId, projectRevisions.id))
          .where(
            and(
              eq(projectPublications.slug, slug),
              eq(projectPublications.isPublished, true),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return row ? toPublicProject(row) : null
      })
    },
    async getPublicProjectVersion(slug, releaseNumber) {
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.public_slug', ${slug}, true)`)
        const [row] = await tx
          .select({
            slug: projectPublications.slug,
            projectId: projects.id,
            name: projectReleases.name,
            description: projectReleases.description,
            revisionId: projectRevisions.id,
            revisionNumber: projectRevisions.revisionNumber,
            releaseNumber: projectReleases.releaseNumber,
            schema: projectRevisions.schema,
            publishedAt: projectReleases.publishedAt,
          })
          .from(projectPublications)
          .innerJoin(projects, eq(projects.id, projectPublications.projectId))
          .innerJoin(projectReleases, eq(projectReleases.projectId, projects.id))
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectReleases.revisionId))
          .where(
            and(
              eq(projectPublications.slug, slug),
              eq(projectPublications.isPublished, true),
              eq(projectReleases.releaseNumber, releaseNumber),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return row ? toPublicProject(row) : null
      })
    },
    async createThumbnailUpload(actorId, accessToken, projectId, input) {
      const validArtifact =
        input.size > 0 &&
        input.size <= MAX_THUMBNAIL_BYTES &&
        ((input.mode === 'auto' &&
          ((input.source === 'renderer' && input.contentType === 'image/webp') ||
            (input.source === 'blueprint' && input.contentType === 'image/svg+xml'))) ||
          (input.mode === 'custom' && input.source === 'custom' && input.contentType === 'image/webp'))
      if (!validArtifact) return null

      const reconciled = await reconcileThumbnailArtifacts(actorId, accessToken, projectId)
      if (!reconciled) return null

      const extension = input.contentType === 'image/webp' ? 'webp' : 'svg'
      const path = `${actorId}/${projectId}/${input.draftVersion}/${randomUUID()}.${extension}`
      // The ledger must exist before Supabase evaluates the signed-upload RLS
      // policy. Use a deliberately long staging deadline, then replace it with
      // the signed token's real expiry after signing completes. If signing or
      // persistence fails, the longer deadline can only delay cleanup; it can
      // never delete an object while a returned upload URL is still valid.
      const expiresAt = new Date(Date.now() + THUMBNAIL_UPLOAD_STAGING_EXPIRES_MS)
      let prepared: true | 'conflict' | null
      try {
        prepared = await withActor(actorId, async tx => {
          const [locked] = await tx
            .select({ id: projects.id, draftVersion: projects.draftVersion })
            .from(projects)
            .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
            .for('update')
            .limit(1)
          if (!locked) return null
          if (locked.draftVersion !== input.draftVersion) return 'conflict'

          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'superseded',
              updatedAt: new Date(),
            })
            .where(
              and(eq(projectThumbnailArtifacts.projectId, projectId), eq(projectThumbnailArtifacts.status, 'pending')),
            )
          await tx.insert(projectThumbnailArtifacts).values({
            projectId,
            path,
            status: 'pending',
            draftVersion: input.draftVersion,
            mode: input.mode,
            source: input.source,
            contentType: input.contentType,
            expectedSize: input.size,
            expiresAt,
            createdBy: actorId,
          })
          const [updated] = await tx
            .update(projects)
            .set({
              thumbnailMode: input.mode,
              thumbnailStatus: 'rendering',
              thumbnailRequestedVersion: input.draftVersion,
              thumbnailPendingPath: path,
              thumbnailPendingContentType: input.contentType,
              thumbnailPendingSize: input.size,
              thumbnailErrorCode: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                isNull(projects.deletedAt),
                eq(projects.draftVersion, input.draftVersion),
              ),
            )
            .returning({ id: projects.id })
          if (!updated) throw new ThumbnailConflictRollback()
          return true
        })
      } catch (error) {
        if (error instanceof ThumbnailConflictRollback) prepared = 'conflict'
        else throw error
      }
      if (prepared !== true) return prepared

      const { data, error } = await thumbnailStorage(accessToken).createSignedUploadUrl(path)
      if (error || !data) {
        await withActor(actorId, async tx => {
          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'upload-signing-failed',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, path),
                eq(projectThumbnailArtifacts.status, 'pending'),
              ),
            )
          await tx
            .update(projects)
            .set({
              thumbnailStatus: 'failed',
              thumbnailErrorCode: 'upload-signing-failed',
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                eq(projects.thumbnailStatus, 'rendering'),
                eq(projects.thumbnailPendingPath, path),
              ),
            )
        })
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
        throw new Error(error?.message ?? 'Supabase did not return a signed thumbnail upload URL')
      }
      const signedExpiresAt = signedThumbnailUploadCleanupExpiry(data.token)
      const signedExpiryPersisted = await withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projectThumbnailArtifacts)
          .set({
            expiresAt: signedExpiresAt,
            nextCleanupAt: sql`case
              when ${projectThumbnailArtifacts.status} = 'cleanup_pending'
                then greatest(
                  coalesce(${projectThumbnailArtifacts.nextCleanupAt}, ${signedExpiresAt}),
                  ${signedExpiresAt}
                )
              else ${projectThumbnailArtifacts.nextCleanupAt}
            end`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, path),
              or(
                eq(projectThumbnailArtifacts.status, 'pending'),
                eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
              ),
            ),
          )
          .returning({ id: projectThumbnailArtifacts.id })
        return Boolean(updated)
      })
      if (!signedExpiryPersisted) {
        throw new Error('Signed thumbnail upload was invalidated before its expiry could be recorded')
      }
      await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      return {
        bucket: THUMBNAIL_BUCKET,
        path,
        signedUrl: data.signedUrl,
        token: data.token,
        draftVersion: input.draftVersion,
        mode: input.mode,
        contentType: input.contentType,
        maxBytes: MAX_THUMBNAIL_BYTES,
        expiresIn: 7200,
      }
    },
    async completeThumbnailUpload(actorId, accessToken, projectId, input) {
      const pending = await withActor(actorId, async tx => {
        const [artifact] = await tx
          .select({
            draftVersion: projectThumbnailArtifacts.draftVersion,
            path: projectThumbnailArtifacts.path,
            contentType: projectThumbnailArtifacts.contentType,
            size: projectThumbnailArtifacts.expectedSize,
            expiresAt: projectThumbnailArtifacts.expiresAt,
          })
          .from(projectThumbnailArtifacts)
          .innerJoin(projects, eq(projects.id, projectThumbnailArtifacts.projectId))
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, input.path),
              eq(projectThumbnailArtifacts.status, 'pending'),
              canEditProject(actorId),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return artifact ?? null
      })
      if (!pending) return null
      if (pending.expiresAt.getTime() <= Date.now()) {
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
        return 'conflict'
      }
      if (pending.draftVersion !== input.draftVersion || pending.path !== input.path) {
        return 'conflict'
      }

      const { data: info, error } = await thumbnailStorage(accessToken).info(input.path)
      if (
        error ||
        !info ||
        info.size !== pending.size ||
        info.contentType !== pending.contentType ||
        info.size > MAX_THUMBNAIL_BYTES
      ) {
        await withActor(actorId, async tx => {
          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'upload-validation-failed',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, input.path),
                eq(projectThumbnailArtifacts.status, 'pending'),
              ),
            )
          await tx
            .update(projects)
            .set({
              thumbnailStatus: 'failed',
              thumbnailErrorCode: 'upload-validation-failed',
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                eq(projects.thumbnailStatus, 'rendering'),
                eq(projects.thumbnailPendingPath, input.path),
                eq(projects.thumbnailRequestedVersion, input.draftVersion),
              ),
            )
        })
        return 'invalid'
      }

      let completed: Awaited<ReturnType<Repository['completeThumbnailUpload']>>
      try {
        completed = await withActor(actorId, async tx => {
          const [locked] = await tx
            .select({
              id: projects.id,
              draftVersion: projects.draftVersion,
              requestedVersion: projects.thumbnailRequestedVersion,
              pendingPath: projects.thumbnailPendingPath,
            })
            .from(projects)
            .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
            .for('update')
            .limit(1)
          if (!locked) return null
          if (
            locked.draftVersion !== input.draftVersion ||
            locked.requestedVersion !== input.draftVersion ||
            locked.pendingPath !== input.path
          ) {
            return 'conflict'
          }

          const [promoted] = await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'current',
              nextCleanupAt: null,
              lastError: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, input.path),
                eq(projectThumbnailArtifacts.status, 'pending'),
                eq(projectThumbnailArtifacts.draftVersion, input.draftVersion),
              ),
            )
            .returning({ id: projectThumbnailArtifacts.id })
          if (!promoted) return 'conflict'

          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'replaced',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.status, 'current'),
                ne(projectThumbnailArtifacts.path, input.path),
              ),
            )
          const [updated] = await tx
            .update(projects)
            .set({
              thumbnailStatus: 'ready',
              thumbnailPath: input.path,
              thumbnailUrl: `/api/projects/${projectId}/thumbnail/content`,
              thumbnailDraftVersion: input.draftVersion,
              thumbnailErrorCode: null,
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                isNull(projects.deletedAt),
                eq(projects.thumbnailStatus, 'rendering'),
                eq(projects.draftVersion, input.draftVersion),
                eq(projects.thumbnailRequestedVersion, input.draftVersion),
                eq(projects.thumbnailPendingPath, input.path),
              ),
            )
            .returning({ id: projects.id })
          if (!updated) throw new ThumbnailConflictRollback()
          const project = await selectProjectDetail(tx, actorId, projectId)
          if (!project) throw new Error('Completed thumbnail project could not be read')
          return project
        })
      } catch (error) {
        if (error instanceof ThumbnailConflictRollback) completed = 'conflict'
        else throw error
      }
      if (completed && completed !== 'conflict') {
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      }
      return completed
    },
    async failThumbnailUpload(actorId, accessToken, projectId, input) {
      const failed = await withActor(actorId, async tx => {
        const [artifact] = await tx
          .update(projectThumbnailArtifacts)
          .set({
            status: 'cleanup_pending',
            nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
            lastError: input.errorCode,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, input.path),
              eq(projectThumbnailArtifacts.status, 'pending'),
              eq(projectThumbnailArtifacts.draftVersion, input.draftVersion),
            ),
          )
          .returning({ id: projectThumbnailArtifacts.id })
        if (!artifact) {
          const [existing] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
            .limit(1)
          return existing ? 'conflict' : false
        }
        const [updated] = await tx
          .update(projects)
          .set({
            thumbnailStatus: 'failed',
            thumbnailErrorCode: input.errorCode,
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
          })
          .where(
            and(
              eq(projects.id, projectId),
              canEditProject(actorId),
              isNull(projects.deletedAt),
              eq(projects.thumbnailStatus, 'rendering'),
              eq(projects.thumbnailRequestedVersion, input.draftVersion),
              eq(projects.thumbnailPendingPath, input.path),
            ),
          )
          .returning({ id: projects.id })
        if (updated) return true
        return 'conflict'
      })
      if (failed === true) {
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      }
      return failed
    },
    reconcileThumbnailArtifacts,
    async getThumbnailDownloadUrl(actorId, accessToken, projectId) {
      const path = await withActor(actorId, async tx => {
        const [project] = await tx
          .select({ thumbnailPath: projects.thumbnailPath })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        return project?.thumbnailPath ?? null
      })
      if (!path) return null
      const { data, error } = await thumbnailStorage(accessToken).createSignedUrl(path, 60)
      if (error || !data) throw new Error(error?.message ?? 'Supabase did not return a signed thumbnail URL')
      return data.signedUrl
    },
    async createAgentAssetUpload(actorId, accessToken, projectId, input) {
      if (input.size > MAX_AGENT_ASSET_BYTES) return 'quota'
      const allowed = new Set([
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/svg+xml',
        'application/pdf',
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ])
      if (!allowed.has(input.contentType)) return null
      let staleStoragePaths: string[] = []
      const result = await withActor(actorId, async tx => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-asset:${input.idempotencyKey}`}, 0))`,
        )
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-asset-quota:${projectId}`}, 0))`,
        )
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        const staleUploads = await tx.execute(sql`
          update app.agent_assets
          set status = 'failed', updated_at = now()
          where actor_id = ${actorId}
            and project_id = ${projectId}
            and status = 'uploading'
            and created_at <= now() - (${AGENT_ASSET_UPLOAD_STALE_HOURS} * interval '1 hour')
          returning storage_path
        `)
        staleStoragePaths = (
          (staleUploads as { rows?: Array<{ storage_path?: unknown }> } | undefined)?.rows ?? []
        ).flatMap(row => (typeof row.storage_path === 'string' ? [row.storage_path] : []))
        const [existing] = await tx
          .select()
          .from(agentAssets)
          .where(and(eq(agentAssets.actorId, actorId), eq(agentAssets.idempotencyKey, input.idempotencyKey)))
          .limit(1)
        if (existing) {
          const expectedConversationId = input.scope === 'conversation' ? (input.conversationId ?? null) : null
          const identityMatches =
            existing.projectId === projectId &&
            existing.conversationId === expectedConversationId &&
            existing.originalName === input.name &&
            existing.contentType === input.contentType &&
            existing.size === input.size
          if (!identityMatches || !['uploading', 'ready'].includes(existing.status)) return 'conflict' as const
          return existing.status === 'ready'
            ? {
                id: existing.id,
                path: existing.storagePath,
                alreadyCompleted: true as const,
                asset: {
                  id: existing.id,
                  originalName: existing.originalName,
                  contentType: existing.contentType,
                  size: existing.size,
                },
              }
            : { id: existing.id, path: existing.storagePath }
        }
        const [usage] = await tx
          .select({ count: sql<number>`count(*)`, size: sql<number>`coalesce(sum(${agentAssets.size}),0)` })
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              inArray(agentAssets.status, ['uploading', 'processing', 'ready']),
            ),
          )
        if (
          Number(usage?.count ?? 0) >= MAX_AGENT_ASSET_COUNT ||
          Number(usage?.size ?? 0) + input.size > 200 * 1024 * 1024
        )
          return 'quota' as const
        const id = randomUUID()
        const path = `${actorId}/${projectId}/${id}/${input.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        await tx.insert(agentAssets).values({
          id,
          actorId,
          idempotencyKey: input.idempotencyKey,
          projectId,
          conversationId: input.scope === 'conversation' ? input.conversationId : null,
          originalName: input.name,
          contentType: input.contentType,
          size: input.size,
          storagePath: path,
        })
        return { id, path }
      })
      if (staleStoragePaths.length > 0) {
        await agentAssetStorage(accessToken)
          .remove(staleStoragePaths)
          .catch(() => undefined)
      }
      if (!result || result === 'quota' || result === 'conflict') return result
      if (result.alreadyCompleted === true) return result
      const { data, error } = await agentAssetStorage(accessToken).createSignedUploadUrl(result.path)
      if (error || !data) {
        await failAgentAssetUpload(actorId, accessToken, result.id)
        throw new Error(error?.message ?? 'Unable to sign agent asset upload')
      }
      return {
        id: result.id,
        bucket: AGENT_ASSET_BUCKET,
        path: result.path,
        signedUrl: data.signedUrl,
        token: data.token,
        maxBytes: MAX_AGENT_ASSET_BYTES,
        expiresIn: 7200,
      }
    },
    async completeAgentAssetUpload(actorId, accessToken, projectId, input) {
      const row = await withActor(actorId, async tx => {
        const [asset] = await tx
          .select()
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, input.id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              canEditAgentAssetProject(actorId),
              ne(agentAssets.status, 'deleted'),
            ),
          )
          .limit(1)
        return asset ?? null
      })
      if (!row || row.storagePath !== input.path) return null
      if (row.status === 'ready') {
        const { modelInputStatus, modelInputBytes, modelInputContentType, modelInputSha256, modelInputSize, ...asset } =
          row
        void modelInputStatus
        void modelInputBytes
        void modelInputContentType
        void modelInputSha256
        void modelInputSize
        return asset as import('../types.js').AgentAssetRecord
      }
      if (row.status !== 'uploading') return 'invalid'
      const { data: info, error } = await agentAssetStorage(accessToken).info(input.path)
      if (error) throw new Error(error.message || 'Unable to inspect agent asset')
      if (!info || info.size !== row.size || info.contentType !== row.contentType) {
        await failAgentAssetUpload(actorId, accessToken, row.id)
        return 'invalid'
      }
      const { data: downloaded, error: downloadError } = await agentAssetStorage(accessToken).download(input.path)
      if (downloadError) throw new Error(downloadError.message || 'Unable to download agent asset')
      if (!downloaded) {
        await failAgentAssetUpload(actorId, accessToken, row.id)
        return 'invalid'
      }
      const bytes = new Uint8Array(await downloaded.arrayBuffer())
      const digest = createHash('sha256').update(bytes).digest('hex')
      const { extractAssetText, detectAssetType } = await import('../agent/asset-extractor.js')
      if (!detectAssetType(row.contentType, bytes)) {
        await failAgentAssetUpload(actorId, accessToken, row.id)
        return 'invalid'
      }
      const extracted = extractAssetText(row.contentType, bytes)
      const updated = await withActor(actorId, async tx => {
        const [completed] = await tx
          .update(agentAssets)
          .set({
            sha256: digest,
            status: 'ready',
            extractedText: extracted.text,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentAssets.id, row.id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.status, 'uploading'),
              canEditAgentAssetProject(actorId),
            ),
          )
          .returning(agentAssetPublicSelection)
        if (completed) return completed
        const [replayed] = await tx
          .select(agentAssetPublicSelection)
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, row.id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.status, 'ready'),
              canEditAgentAssetProject(actorId),
            ),
          )
          .limit(1)
        return replayed ?? null
      })
      return updated ? ({ ...updated, status: updated.status } as import('../types.js').AgentAssetRecord) : null
    },
    async getAgentAsset(actorId, projectId, id) {
      return withActor(actorId, async tx => {
        const [row] = await tx
          .select(agentAssetPublicSelection)
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              ne(agentAssets.status, 'deleted'),
            ),
          )
          .limit(1)
        return (row as import('../types.js').AgentAssetRecord | undefined) ?? null
      })
    },
    getAgentAssetModelInput(actorId, projectId, assetId) {
      return withActor(actorId, async tx => {
        const [asset] = await tx
          .select({
            contentType: agentAssets.contentType,
            size: agentAssets.size,
            status: agentAssets.status,
            modelInputStatus: agentAssets.modelInputStatus,
            modelInputBytes: agentAssets.modelInputBytes,
            modelInputContentType: agentAssets.modelInputContentType,
            modelInputSha256: agentAssets.modelInputSha256,
            modelInputSize: agentAssets.modelInputSize,
          })
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, assetId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.projectId, projectId),
              ne(agentAssets.status, 'deleted'),
            ),
          )
          .limit(1)
        if (!asset) return null
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.contentType)) return 'unsupported'
        if (asset.size > 4 * 1024 * 1024 || asset.modelInputStatus === 'failed') return 'oversize'
        if (
          asset.status !== 'ready' ||
          asset.modelInputStatus !== 'ready' ||
          !asset.modelInputBytes ||
          !asset.modelInputContentType ||
          !asset.modelInputSha256 ||
          asset.modelInputSize === null
        ) {
          return null
        }
        return {
          record: {
            contentType: asset.modelInputContentType,
            size: asset.modelInputSize,
            sha256: asset.modelInputSha256,
          },
          bytes: new Uint8Array(asset.modelInputBytes),
        }
      })
    },
    persistAgentAssetModelInput(actorId, projectId, assetId, input) {
      return withActor(actorId, async tx => {
        const bytes = Buffer.from(input.bytes)
        if (bytes.byteLength !== input.record.size || bytes.byteLength > 4 * 1024 * 1024) return false
        const [persisted] = await tx
          .update(agentAssets)
          .set({
            modelInputStatus: 'ready',
            modelInputBytes: bytes,
            modelInputContentType: input.record.contentType,
            modelInputSha256: input.record.sha256,
            modelInputSize: input.record.size,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentAssets.id, assetId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.status, 'ready'),
              eq(agentAssets.contentType, input.record.contentType),
              isNull(agentAssets.modelInputStatus),
              isNull(agentAssets.modelInputBytes),
            ),
          )
          .returning({ id: agentAssets.id })
        if (persisted) return true
        const [existing] = await tx
          .select({
            status: agentAssets.modelInputStatus,
            bytes: agentAssets.modelInputBytes,
            contentType: agentAssets.modelInputContentType,
            sha256: agentAssets.modelInputSha256,
            size: agentAssets.modelInputSize,
          })
          .from(agentAssets)
          .where(
            and(eq(agentAssets.id, assetId), eq(agentAssets.actorId, actorId), eq(agentAssets.projectId, projectId)),
          )
          .limit(1)
        return Boolean(
          existing?.status === 'ready' &&
            existing.contentType === input.record.contentType &&
            existing.sha256 === input.record.sha256 &&
            existing.size === input.record.size &&
            existing.bytes?.equals(bytes),
        )
      })
    },
    async listAgentAssets(actorId, projectId, conversationId) {
      return withActor(actorId, async tx => {
        const rows = await tx
          .select(agentAssetPublicSelection)
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              ne(agentAssets.status, 'deleted'),
              conversationId
                ? or(eq(agentAssets.conversationId, conversationId), isNull(agentAssets.conversationId))
                : isNull(agentAssets.conversationId),
            ),
          )
          .orderBy(desc(agentAssets.createdAt))
        return rows as import('../types.js').AgentAssetRecord[]
      })
    },
    async getAgentAssetDownloadUrl(actorId, accessToken, projectId, id) {
      const asset = await withActor(actorId, async tx => {
        const [row] = await tx
          .select()
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              ne(agentAssets.status, 'deleted'),
            ),
          )
          .limit(1)
        return row ?? null
      })
      if (!asset) return null
      const { data, error } = await agentAssetStorage(accessToken).createSignedUrl(asset.storagePath, 60)
      if (error || !data) return null
      return data.signedUrl
    },
    async deleteAgentAsset(actorId, accessToken, projectId, id) {
      const cleanup = await withActor(actorId, async tx => {
        const [row] = await tx
          .select({
            id: agentAssets.id,
            status: agentAssets.status,
            storagePath: agentAssets.storagePath,
            storageCleanupStatus: agentAssets.storageCleanupStatus,
          })
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              canEditAgentAssetProject(actorId),
            ),
          )
          .for('update')
          .limit(1)
        if (!row) return null
        if (row.status === 'deleted') {
          return {
            storagePath: row.storagePath,
            pending: row.storageCleanupStatus !== 'completed',
          }
        }
        const [deleted] = await tx
          .update(agentAssets)
          .set({
            status: 'deleted',
            modelInputStatus: null,
            modelInputBytes: null,
            modelInputContentType: null,
            modelInputSha256: null,
            modelInputSize: null,
            storageCleanupStatus: 'pending',
            storageCleanupAttempts: 0,
            storageCleanupLastError: null,
            storageCleanupCompletedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              ne(agentAssets.status, 'deleted'),
              canEditAgentAssetProject(actorId),
            ),
          )
          .returning({ storagePath: agentAssets.storagePath })
        return deleted ? { storagePath: deleted.storagePath, pending: true } : null
      })
      if (!cleanup) return false
      if (!cleanup.pending) return true
      const { error } = await agentAssetStorage(accessToken).remove([cleanup.storagePath])
      if (error) {
        await withActor(actorId, tx =>
          tx
            .update(agentAssets)
            .set({
              storageCleanupAttempts: sql`${agentAssets.storageCleanupAttempts} + 1`,
              storageCleanupLastError: (error.message || 'Unable to delete agent asset').slice(0, 1000),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(agentAssets.id, id),
                eq(agentAssets.projectId, projectId),
                eq(agentAssets.actorId, actorId),
                eq(agentAssets.status, 'deleted'),
                eq(agentAssets.storageCleanupStatus, 'pending'),
                canEditAgentAssetProject(actorId),
              ),
            ),
        ).catch(() => undefined)
        throw new Error(error.message || 'Unable to delete agent asset')
      }
      const completed = await withActor(actorId, async tx => {
        const [updated] = await tx
          .update(agentAssets)
          .set({
            storageCleanupStatus: 'completed',
            storageCleanupAttempts: sql`${agentAssets.storageCleanupAttempts} + 1`,
            storageCleanupLastError: null,
            storageCleanupCompletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.status, 'deleted'),
              eq(agentAssets.storageCleanupStatus, 'pending'),
              canEditAgentAssetProject(actorId),
            ),
          )
          .returning({ id: agentAssets.id })
        if (updated) return true
        const [replayed] = await tx
          .select({ id: agentAssets.id })
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.status, 'deleted'),
              eq(agentAssets.storageCleanupStatus, 'completed'),
              canEditAgentAssetProject(actorId),
            ),
          )
          .limit(1)
        return Boolean(replayed)
      })
      if (!completed) throw new Error('Unable to finalize agent asset deletion')
      return true
    },
    async reserveAgentRunCost(actorId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        await tx.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(
            ${`agent-budget:${input.billingScope}:${input.payerId}:`} ||
            to_char(now() at time zone 'UTC', 'YYYY-MM'),
            0
          ))
        `)
        await tx.execute(sql`
          update app.agent_run_costs as cost
          set state = 'settled',
              accuracy = 'billing_indeterminate',
              settled_micros = cost.reserved_micros,
              minimum_micros = 0,
              maximum_micros = cost.reserved_micros,
              updated_at = ${input.now}
          where cost.actor_id = ${actorId}
            and cost.project_id = ${input.projectId}
            and cost.state = 'reserved'
            and cost.reservation_expires_at <= ${input.now}
            and exists (
              select 1
              from app.agent_run_dispatches as dispatch
              join app.agent_provider_attempts as attempt on attempt.dispatch_id = dispatch.id
              where dispatch.actor_id = cost.actor_id
                and dispatch.project_id = cost.project_id
                and dispatch.turn_id = cost.turn_id
                and attempt.attempt_no = (
                  select max(latest.attempt_no)
                  from app.agent_provider_attempts as latest
                  where latest.dispatch_id = dispatch.id
                )
                and attempt.state in ('started', 'outcome_unknown')
            )
        `)
        await tx
          .update(agentRunCosts)
          .set({
            state: 'released',
            accuracy: null,
            settledMicros: 0,
            minimumMicros: null,
            maximumMicros: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.state, 'reserved'),
              lte(agentRunCosts.reservationExpiresAt, input.now),
            ),
          )
        const [existing] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.turnId, input.turnId),
            ),
          )
          .limit(1)
        if (existing && (existing.taskId !== input.taskId || existing.inputDigest !== input.inputDigest)) {
          return 'conflict'
        }
        if (existing && existing.state !== 'released') return existing as import('../types.js').AgentRunCostRecord
        if (input.estimatedMicros > input.taskLimitMicros) return 'task_budget_exceeded'
        const [usage] = await tx
          .select({
            taskMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.actorId} = ${actorId}
                and ${agentRunCosts.projectId} = ${input.projectId}
                and ${agentRunCosts.taskId} = ${input.taskId}
                then case
                  when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
                  when ${agentRunCosts.accuracy} = 'billing_indeterminate' then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
                  else ${agentRunCosts.settledMicros}
                end
              else 0
            end), 0)`,
            projectMonthMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.billingScope} = ${input.billingScope}
                and ${agentRunCosts.payerId} = ${input.payerId}
                and (${input.billingScope} = 'user' or ${agentRunCosts.projectId} = ${input.projectId})
                and ${agentRunCosts.createdAt} >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
                then case
              when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
              when ${agentRunCosts.accuracy} = 'billing_indeterminate' then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
              else ${agentRunCosts.settledMicros}
                end
              else 0
            end), 0)`,
          })
          .from(agentRunCosts)
          .where(
            and(
              ne(agentRunCosts.state, 'released'),
              or(
                and(eq(agentRunCosts.actorId, actorId), eq(agentRunCosts.taskId, input.taskId)),
                and(
                  eq(agentRunCosts.billingScope, input.billingScope),
                  eq(agentRunCosts.payerId, input.payerId),
                  input.billingScope === 'project' ? eq(agentRunCosts.projectId, input.projectId) : undefined,
                  sql`${agentRunCosts.createdAt} >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`,
                ),
              ),
            ),
          )
        if (Number(usage?.taskMicros ?? 0) + input.estimatedMicros > input.taskLimitMicros) {
          return 'task_budget_exceeded'
        }
        if (Number(usage?.projectMonthMicros ?? 0) + input.estimatedMicros > input.projectMonthLimitMicros) {
          return 'project_budget_exceeded'
        }
        if (existing) {
          const [reactivated] = await tx
            .update(agentRunCosts)
            .set({
              state: 'reserved',
              reservedMicros: input.estimatedMicros,
              settledMicros: 0,
              minimumMicros: null,
              maximumMicros: null,
              operationId: input.operationId,
              provider: input.provider,
              model: input.model,
              profile: input.profile,
              promptTokens: null,
              completionTokens: null,
              traceId: input.traceId,
              decisionOutput: null,
              decisionUsage: null,
              decisionTrace: null,
              billingScope: input.billingScope,
              payerId: input.payerId,
              reservationExpiresAt: input.reservationExpiresAt,
              updatedAt: input.now,
            })
            .where(eq(agentRunCosts.id, existing.id))
            .returning()
          if (!reactivated) throw new Error('Agent cost reservation reactivation returned no row')
          return reactivated as import('../types.js').AgentRunCostRecord
        }
        const [row] = await tx
          .insert(agentRunCosts)
          .values({
            actorId,
            projectId: input.projectId,
            taskId: input.taskId,
            turnId: input.turnId,
            inputDigest: input.inputDigest,
            reservedMicros: input.estimatedMicros,
            operationId: input.operationId,
            provider: input.provider,
            model: input.model,
            profile: input.profile,
            traceId: input.traceId,
            billingScope: input.billingScope,
            payerId: input.payerId,
            reservationExpiresAt: input.reservationExpiresAt,
            state: 'reserved',
          })
          .returning()
        return row as import('../types.js').AgentRunCostRecord
      })
    },
    async settleAgentRunCost(actorId, input) {
      return withActor(actorId, async tx => {
        const [settled] = await tx
          .update(agentRunCosts)
          .set({
            state: 'settled',
            accuracy: input.indeterminate ? 'billing_indeterminate' : 'estimated',
            settledMicros: input.settledMicros,
            minimumMicros: input.minimumMicros,
            maximumMicros: input.maximumMicros,
            promptTokens: input.promptTokens,
            completionTokens: input.completionTokens,
            decisionOutput: input.decisionOutput ?? null,
            decisionUsage: input.decisionUsage ?? null,
            decisionTrace: input.decisionTrace ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.taskId, input.taskId),
              eq(agentRunCosts.turnId, input.turnId),
              eq(agentRunCosts.state, 'reserved'),
            ),
          )
          .returning()
        if (settled) return settled as AgentRunCostRecord
        const [existing] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.taskId, input.taskId),
              eq(agentRunCosts.turnId, input.turnId),
            ),
          )
          .limit(1)
        return (existing as AgentRunCostRecord | undefined) ?? null
      })
    },
    async releaseAgentRunCost(actorId, projectId, taskId) {
      return withActor(actorId, async tx => {
        await tx
          .update(agentRunCosts)
          .set({ state: 'released', accuracy: null, updatedAt: new Date() })
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.taskId, taskId),
              eq(agentRunCosts.state, 'reserved'),
            ),
          )
        const costs = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.taskId, taskId),
            ),
          )
          .orderBy(desc(agentRunCosts.createdAt), desc(agentRunCosts.id))
        return aggregateAgentRunCostRows(costs as AgentRunCostRecord[])
      })
    },
    async getAgentBudgetUsage(actorId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        const chargedMicros = sql<number>`case
          when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
          when ${agentRunCosts.accuracy} = 'billing_indeterminate' then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
          else ${agentRunCosts.settledMicros}
        end`
        const [usage] = await tx
          .select({
            taskMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.actorId} = ${actorId}
                and ${agentRunCosts.projectId} = ${input.projectId}
                and ${agentRunCosts.taskId} = ${input.taskId}
                then ${chargedMicros}
              else 0
            end), 0)`,
            projectMonthMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.billingScope} = ${input.billingScope}
                and ${agentRunCosts.payerId} = ${input.payerId}
                and (${input.billingScope} = 'user' or ${agentRunCosts.projectId} = ${input.projectId})
                and ${agentRunCosts.createdAt} >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
                then ${chargedMicros}
              else 0
            end), 0)`,
          })
          .from(agentRunCosts)
          .where(
            and(
              ne(agentRunCosts.state, 'released'),
              or(
                and(eq(agentRunCosts.actorId, actorId), eq(agentRunCosts.taskId, input.taskId)),
                and(
                  eq(agentRunCosts.billingScope, input.billingScope),
                  eq(agentRunCosts.payerId, input.payerId),
                  input.billingScope === 'project' ? eq(agentRunCosts.projectId, input.projectId) : undefined,
                  sql`${agentRunCosts.createdAt} >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`,
                ),
              ),
            ),
          )
        return {
          taskMicros: Number(usage?.taskMicros ?? 0),
          projectMonthMicros: Number(usage?.projectMonthMicros ?? 0),
        }
      })
    },
    async listTemplates() {
      return db.select().from(templates).where(eq(templates.isOfficial, true)).orderBy(asc(templates.name))
    },
    getSettings(actorId) {
      return withActor(actorId, async tx => {
        const [row] = await tx.select().from(userSettings).where(eq(userSettings.userId, actorId)).limit(1)
        return row?.settings ?? {}
      })
    },
    updateSettings(actorId, settings) {
      return withActor(actorId, async tx => {
        await lockUserSettings(tx, actorId)
        const [current] = await tx
          .select({ settings: userSettings.settings })
          .from(userSettings)
          .where(eq(userSettings.userId, actorId))
          .for('update')
          .limit(1)
        const { agentPreferenceMemory: _reservedPreferenceMemory, ...patch } = settings
        const nextSettings = { ...(current?.settings ?? {}), ...patch }
        const [row] = await tx
          .insert(userSettings)
          .values({ userId: actorId, settings: nextSettings })
          .onConflictDoUpdate({
            target: userSettings.userId,
            set: { settings: nextSettings, updatedAt: new Date() },
          })
          .returning()
        return row?.settings ?? nextSettings
      })
    },
    getAgentUserPreferenceMemory(actorId) {
      return withActor(actorId, async tx => {
        const [row] = await tx
          .select({ settings: userSettings.settings })
          .from(userSettings)
          .where(eq(userSettings.userId, actorId))
          .limit(1)
        return readAgentUserPreferenceMemory(row?.settings ?? {})
      })
    },
    compareAndSetAgentUserPreferenceMemory(actorId, expectedRevision, memory) {
      return withActor(actorId, async tx => {
        await lockUserSettings(tx, actorId)
        const [row] = await tx
          .select({ settings: userSettings.settings })
          .from(userSettings)
          .where(eq(userSettings.userId, actorId))
          .limit(1)
        const settings = row?.settings ?? {}
        if (readAgentUserPreferenceMemory(settings).revision !== expectedRevision) return false
        const nextSettings = { ...settings, agentPreferenceMemory: memory }
        await tx
          .insert(userSettings)
          .values({ userId: actorId, settings: nextSettings })
          .onConflictDoUpdate({
            target: userSettings.userId,
            set: { settings: nextSettings, updatedAt: new Date() },
          })
        return true
      })
    },
    compareAndSetAgentUserModelConfig(actorId, expected, config) {
      return withActor(actorId, async tx => {
        await lockUserSettings(tx, actorId)
        const [updated] = await tx
          .update(userSettings)
          .set({
            settings: sql`jsonb_set(${userSettings.settings}, '{agentModelConfiguration,user}', ${JSON.stringify(config)}::jsonb, false)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(userSettings.userId, actorId),
              sql`${userSettings.settings} -> 'agentModelConfiguration' -> 'user' = ${JSON.stringify(expected)}::jsonb`,
            ),
          )
          .returning({ userId: userSettings.userId })
        return Boolean(updated)
      })
    },
    getAgentWorkspace(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [row] = await tx
          .select({
            ownerId: agentWorkspaces.ownerId,
            projectId: agentWorkspaces.projectId,
            revision: agentWorkspaces.revision,
            payload: agentWorkspaces.payload,
            createdAt: agentWorkspaces.createdAt,
            updatedAt: agentWorkspaces.updatedAt,
          })
          .from(agentWorkspaces)
          .innerJoin(projects, eq(projects.id, agentWorkspaces.projectId))
          .where(
            and(
              eq(agentWorkspaces.ownerId, actorId),
              eq(agentWorkspaces.projectId, projectId),
              canReadProject(actorId),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        if (!row) return null
        return row as AgentWorkspaceRecord
      })
    },
    upsertAgentWorkspace(actorId, projectId, payload, expectedRevision) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        const [existing] = await tx
          .select({ id: agentWorkspaces.id, revision: agentWorkspaces.revision })
          .from(agentWorkspaces)
          .where(and(eq(agentWorkspaces.ownerId, actorId), eq(agentWorkspaces.projectId, projectId)))
          .limit(1)
        if (existing) {
          if (expectedRevision === undefined || existing.revision !== expectedRevision) return 'conflict'
          const [updated] = await tx
            .update(agentWorkspaces)
            .set({ payload, revision: expectedRevision + 1, updatedAt: new Date() })
            .where(and(eq(agentWorkspaces.id, existing.id), eq(agentWorkspaces.revision, expectedRevision)))
            .returning()
          return updated ? (updated as AgentWorkspaceRecord) : ('conflict' as const)
        }
        if (expectedRevision !== undefined) return 'conflict'
        const [created] = await tx
          .insert(agentWorkspaces)
          .values({ ownerId: actorId, projectId, payload })
          .onConflictDoNothing({ target: [agentWorkspaces.ownerId, agentWorkspaces.projectId] })
          .returning()
        return created ? (created as AgentWorkspaceRecord) : ('conflict' as const)
      })
    },
    listAgentProjectContexts(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        const rows = await tx
          .select()
          .from(agentProjectContexts)
          .where(and(eq(agentProjectContexts.projectId, projectId), isNull(agentProjectContexts.deletedAt)))
          .orderBy(asc(agentProjectContexts.createdAt))
        return rows.map(toAgentProjectContextRecord)
      })
    },
    upsertAgentProjectContext(actorId, projectId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        const now = new Date()
        if (!input.id) {
          if (input.expectedRevision !== undefined) return 'conflict'
          const [created] = await tx
            .insert(agentProjectContexts)
            .values({
              projectId,
              title: input.title,
              content: input.content,
              sourceTaskId: input.sourceTaskId,
              provenance: input.provenance,
              createdBy: actorId,
              confirmedAt: now,
              updatedAt: now,
            })
            .returning()
          if (!created) throw new Error('Agent project context insert returned no row')
          return toAgentProjectContextRecord(created)
        }
        const [current] = await tx
          .select()
          .from(agentProjectContexts)
          .where(
            and(
              eq(agentProjectContexts.id, input.id),
              eq(agentProjectContexts.projectId, projectId),
              isNull(agentProjectContexts.deletedAt),
            ),
          )
          .for('update')
          .limit(1)
        if (!current) return null
        if (input.expectedRevision === undefined || current.revision !== input.expectedRevision) return 'conflict'
        const [updated] = await tx
          .update(agentProjectContexts)
          .set({
            title: input.title,
            content: input.content,
            revision: current.revision + 1,
            history: [
              ...current.history,
              {
                revision: current.revision,
                title: current.title,
                content: current.content,
                status: 'confirmed' as const,
                ...(current.sourceTaskId ? { sourceTaskId: current.sourceTaskId } : {}),
                ...(current.provenance ? { provenance: current.provenance } : {}),
                createdAt: current.updatedAt.toISOString(),
              },
            ],
            sourceTaskId: input.sourceTaskId ?? current.sourceTaskId,
            provenance: input.provenance ?? current.provenance,
            confirmedAt: now,
            updatedAt: now,
          })
          .where(and(eq(agentProjectContexts.id, current.id), eq(agentProjectContexts.revision, current.revision)))
          .returning()
        return updated ? toAgentProjectContextRecord(updated) : ('conflict' as const)
      })
    },
    rollbackAgentProjectContext(actorId, projectId, id, expectedRevision, targetRevision) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        const [current] = await tx
          .select()
          .from(agentProjectContexts)
          .where(
            and(
              eq(agentProjectContexts.id, id),
              eq(agentProjectContexts.projectId, projectId),
              isNull(agentProjectContexts.deletedAt),
            ),
          )
          .for('update')
          .limit(1)
        if (!current) return null
        if (current.revision !== expectedRevision) return 'conflict'
        const target = current.history.find(item => item.revision === targetRevision)
        if (!target) return null
        const now = new Date()
        const [updated] = await tx
          .update(agentProjectContexts)
          .set({
            title: target.title,
            content: target.content,
            revision: current.revision + 1,
            history: [
              ...current.history,
              {
                revision: current.revision,
                title: current.title,
                content: current.content,
                status: 'confirmed' as const,
                ...(current.sourceTaskId ? { sourceTaskId: current.sourceTaskId } : {}),
                ...(current.provenance ? { provenance: current.provenance } : {}),
                createdAt: current.updatedAt.toISOString(),
              },
            ],
            sourceTaskId: target.sourceTaskId ?? null,
            provenance: target.provenance ?? null,
            confirmedAt: now,
            updatedAt: now,
          })
          .where(and(eq(agentProjectContexts.id, id), eq(agentProjectContexts.revision, expectedRevision)))
          .returning()
        return updated ? toAgentProjectContextRecord(updated) : ('conflict' as const)
      })
    },
    deleteAgentProjectContext(actorId, projectId, id, expectedRevision) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        const [current] = await tx
          .select({ revision: agentProjectContexts.revision })
          .from(agentProjectContexts)
          .where(
            and(
              eq(agentProjectContexts.id, id),
              eq(agentProjectContexts.projectId, projectId),
              isNull(agentProjectContexts.deletedAt),
            ),
          )
          .for('update')
          .limit(1)
        if (!current) return null
        if (current.revision !== expectedRevision) return 'conflict'
        const [deleted] = await tx
          .update(agentProjectContexts)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(agentProjectContexts.id, id), eq(agentProjectContexts.revision, expectedRevision)))
          .returning({ id: agentProjectContexts.id })
        return deleted ? true : ('conflict' as const)
      })
    },
  }
}
