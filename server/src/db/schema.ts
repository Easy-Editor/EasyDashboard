import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { AgentSkillTrace } from '../agent/agent-skill-trace.js'
import type { AgentProjectContextProvenance, AgentProjectContextRevision } from '../types.js'
import type { ProjectSchema } from '../validation.js'

export const appSchema = pgSchema('app')
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

export const spaces = appSchema.table(
  'spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    personalOwnerId: uuid('personal_owner_id'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [uniqueIndex('spaces_personal_owner_uidx').on(table.personalOwnerId)],
)

export const spaceMembers = appSchema.table(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [primaryKey({ columns: [table.spaceId, table.userId], name: 'space_members_pkey' })],
)

export const projects = appSchema.table(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    draftSchema: jsonb('draft_schema').$type<ProjectSchema>().notNull(),
    draftVersion: integer('draft_version').notNull().default(1),
    pageCount: integer('page_count').notNull().default(1),
    canvasWidth: integer('canvas_width').notNull().default(1920),
    canvasHeight: integer('canvas_height').notNull().default(1080),
    startPageId: text('start_page_id'),
    draftSavedAt: timestamp('draft_saved_at', { withTimezone: true }).notNull().defaultNow(),
    thumbnailMode: text('thumbnail_mode').$type<'auto' | 'custom'>().notNull().default('auto'),
    thumbnailStatus: text('thumbnail_status')
      .$type<'queued' | 'rendering' | 'ready' | 'failed'>()
      .notNull()
      .default('queued'),
    thumbnailPath: text('thumbnail_path'),
    thumbnailUrl: text('thumbnail_url'),
    thumbnailDraftVersion: integer('thumbnail_draft_version'),
    thumbnailErrorCode: text('thumbnail_error_code'),
    thumbnailRequestedVersion: integer('thumbnail_requested_version'),
    thumbnailPendingPath: text('thumbnail_pending_path'),
    thumbnailPendingContentType: text('thumbnail_pending_content_type'),
    thumbnailPendingSize: integer('thumbnail_pending_size'),
    agentModelConfiguration: jsonb('agent_model_configuration').$type<Record<string, unknown>>(),
    agentStartIdempotencyKey: text('agent_start_idempotency_key'),
    agentStartInputDigest: text('agent_start_input_digest'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    permanentDeleteToken: uuid('permanent_delete_token'),
    permanentDeleteStartedAt: timestamp('permanent_delete_started_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('projects_owner_updated_idx').on(table.ownerId, table.updatedAt),
    index('projects_space_updated_idx').on(table.spaceId, table.updatedAt),
    uniqueIndex('projects_owner_agent_start_idempotency_uidx').on(table.ownerId, table.agentStartIdempotencyKey),
  ],
)

export const projectMembers = appSchema.table(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    role: text('role').$type<'owner' | 'editor' | 'viewer'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
  },
  table => [
    primaryKey({ columns: [table.projectId, table.userId], name: 'project_members_pkey' }),
    index('project_members_user_idx').on(table.userId, table.projectId),
  ],
)

export const projectFavorites = appSchema.table(
  'project_favorites',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [primaryKey({ columns: [table.projectId, table.userId], name: 'project_favorites_pkey' })],
)

export const agentAssets = appSchema.table(
  'agent_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id'),
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256'),
    status: text('status')
      .$type<'uploading' | 'processing' | 'ready' | 'failed' | 'deleted'>()
      .notNull()
      .default('uploading'),
    storagePath: text('storage_path').notNull().unique(),
    extractedText: text('extracted_text'),
    modelInputStatus: text('model_input_status').$type<'pending' | 'ready' | 'failed'>(),
    modelInputBytes: bytea('model_input_bytes'),
    modelInputContentType: text('model_input_content_type').$type<'image/png' | 'image/jpeg' | 'image/webp'>(),
    modelInputSha256: text('model_input_sha256'),
    modelInputSize: integer('model_input_size'),
    storageCleanupStatus: text('storage_cleanup_status').$type<'pending' | 'completed'>(),
    storageCleanupAttempts: integer('storage_cleanup_attempts').notNull().default(0),
    storageCleanupLastError: text('storage_cleanup_last_error'),
    storageCleanupCompletedAt: timestamp('storage_cleanup_completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('agent_assets_actor_idempotency_uidx').on(table.actorId, table.idempotencyKey),
    index('agent_assets_project_idx').on(table.projectId, table.createdAt),
  ],
)

export const projectThumbnailArtifacts = appSchema.table(
  'project_thumbnail_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    path: text('path').notNull(),
    status: text('status').$type<'pending' | 'current' | 'cleanup_pending' | 'deleted'>().notNull(),
    draftVersion: integer('draft_version').notNull(),
    mode: text('mode').$type<'auto' | 'custom'>().notNull(),
    source: text('source').$type<'renderer' | 'blueprint' | 'custom'>().notNull(),
    contentType: text('content_type').$type<'image/webp' | 'image/svg+xml'>().notNull(),
    expectedSize: integer('expected_size').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    cleanupAttempts: integer('cleanup_attempts').notNull().default(0),
    nextCleanupAt: timestamp('next_cleanup_at', { withTimezone: true }),
    cleanupLeaseToken: uuid('cleanup_lease_token'),
    cleanupLeaseUntil: timestamp('cleanup_lease_until', { withTimezone: true }),
    lastError: text('last_error'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    uniqueIndex('project_thumbnail_artifacts_path_uidx').on(table.path),
    index('project_thumbnail_artifacts_cleanup_idx').on(table.projectId, table.status, table.nextCleanupAt),
    index('project_thumbnail_artifacts_global_cleanup_idx').on(
      table.status,
      table.nextCleanupAt,
      table.expiresAt,
      table.cleanupLeaseUntil,
    ),
  ],
)

export const projectRevisions = appSchema.table(
  'project_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    kind: text('kind').$type<'auto' | 'manual' | 'pre_restore' | 'publish' | 'agent'>().notNull(),
    label: text('label'),
    sourceDraftVersion: integer('source_draft_version').notNull(),
    schema: jsonb('schema').$type<ProjectSchema>().notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('project_revisions_project_number_uidx').on(table.projectId, table.revisionNumber),
    index('project_revisions_project_created_idx').on(table.projectId, table.createdAt),
  ],
)

export const agentSpikeOperations = appSchema.table(
  'agent_spike_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    stageId: text('stage_id').notNull(),
    executorId: text('executor_id').notNull(),
    operationId: text('operation_id').notNull(),
    grantJti: text('grant_jti').notNull(),
    baseDraftVersion: integer('base_draft_version').notNull(),
    inputDigest: text('input_digest').notNull(),
    executorInput: jsonb('executor_input').$type<Record<string, unknown>>().notNull(),
    issueDigest: text('issue_digest').notNull(),
    skillTrace: jsonb('skill_trace').$type<AgentSkillTrace>(),
    compatibility: jsonb('compatibility').$type<Record<string, string>>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status')
      .$type<'issued' | 'prepared' | 'committed' | 'rejected_stale' | 'failed_not_applied' | 'indeterminate'>()
      .notNull()
      .default('issued'),
    candidateDigest: text('candidate_digest'),
    preparedDigest: text('prepared_digest'),
    candidateSchema: jsonb('candidate_schema').$type<ProjectSchema>(),
    hostReceipt: jsonb('host_receipt').$type<Record<string, unknown>>(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>(),
    preparedAt: timestamp('prepared_at', { withTimezone: true }),
    committedDraftVersion: integer('committed_draft_version'),
    rollbackRevisionId: uuid('rollback_revision_id').references(() => projectRevisions.id, { onDelete: 'restrict' }),
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
    rollbackReceipt: jsonb('rollback_receipt').$type<Record<string, unknown>>(),
    outcome: jsonb('outcome').$type<Record<string, unknown>>(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('agent_spike_operations_actor_operation_uidx').on(table.actorId, table.operationId),
    uniqueIndex('agent_spike_operations_grant_jti_uidx').on(table.grantJti),
    index('agent_spike_operations_project_created_idx').on(table.projectId, table.createdAt),
  ],
)

/** Durable per-user/per-project Agent workspace aggregate. The JSON payload is
 * intentionally versioned so the client domain can evolve without widening
 * this table for every conversational field. */
export const agentWorkspaces = appSchema.table(
  'agent_workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull().default(1),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('agent_workspaces_owner_project_uidx').on(table.ownerId, table.projectId),
    index('agent_workspaces_project_updated_idx').on(table.projectId, table.updatedAt),
  ],
)

export const agentProjectContexts = appSchema.table(
  'agent_project_contexts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    revision: integer('revision').notNull().default(1),
    history: jsonb('history').$type<AgentProjectContextRevision[]>().notNull().default([]),
    sourceTaskId: text('source_task_id'),
    provenance: jsonb('provenance').$type<AgentProjectContextProvenance>(),
    createdBy: uuid('created_by').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('agent_project_contexts_project_updated_idx').on(table.projectId, table.updatedAt)],
)

export const projectPublishSnapshots = appSchema.table(
  'project_publish_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    draftVersion: integer('draft_version').notNull(),
    document: jsonb('document').$type<ProjectSchema>().notNull(),
    documentSha256: text('document_sha256').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('project_publish_snapshots_project_version_uidx').on(table.projectId, table.draftVersion),
    uniqueIndex('project_publish_snapshots_id_project_digest_uidx').on(table.id, table.projectId, table.documentSha256),
    index('project_publish_snapshots_project_created_idx').on(table.projectId, table.createdAt),
  ],
)

export const projectPreviewRuns = appSchema.table(
  'project_preview_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull(),
    publishSnapshotId: uuid('publish_snapshot_id')
      .notNull()
      .references(() => projectPublishSnapshots.id, { onDelete: 'cascade' })
      .unique(),
    source: text('source')
      .$type<'agent_executor' | 'owner_live_render_attestation' | 'editor_renderer_artifact'>()
      .notNull(),
    status: text('status').$type<'verified'>().notNull(),
    documentSha256: text('document_sha256').notNull(),
    rendererVersion: text('renderer_version').notNull(),
    rendererSha256: text('renderer_sha256').notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
    agentOperationId: uuid('agent_operation_id').references(() => agentSpikeOperations.id, { onDelete: 'restrict' }),
    thumbnailArtifactId: uuid('thumbnail_artifact_id'),
    artifactPath: text('artifact_path'),
    artifactSize: integer('artifact_size'),
    artifactDraftVersion: integer('artifact_draft_version'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('project_preview_runs_id_snapshot_project_uidx').on(table.id, table.publishSnapshotId, table.projectId),
    uniqueIndex('project_preview_runs_agent_operation_uidx').on(table.agentOperationId),
  ],
)

export const projectPublications = appSchema.table(
  'project_publications',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull(),
    slug: text('slug').notNull(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => projectRevisions.id, { onDelete: 'restrict' }),
    isPublished: boolean('is_published').notNull().default(true),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.projectId], name: 'project_publications_pkey' }),
    uniqueIndex('project_publications_slug_uidx').on(table.slug),
  ],
)

export const projectReleases = appSchema.table(
  'project_releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    releaseNumber: integer('release_number').notNull(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => projectRevisions.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    publishedBy: uuid('published_by').notNull(),
    publishSnapshotId: uuid('publish_snapshot_id').references(() => projectPublishSnapshots.id, {
      onDelete: 'restrict',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('project_releases_project_number_uidx').on(table.projectId, table.releaseNumber),
    uniqueIndex('project_releases_revision_uidx').on(table.revisionId),
    uniqueIndex('project_releases_publish_snapshot_uidx').on(table.publishSnapshotId),
  ],
)

export const projectPublishApprovals = appSchema.table('project_publish_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  publishSnapshotId: uuid('publish_snapshot_id')
    .notNull()
    .references(() => projectPublishSnapshots.id, { onDelete: 'cascade' })
    .unique(),
  previewRunId: uuid('preview_run_id')
    .notNull()
    .references(() => projectPreviewRuns.id, { onDelete: 'cascade' }),
  approvedBy: uuid('approved_by').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  consumedReleaseId: uuid('consumed_release_id').references(() => projectReleases.id, { onDelete: 'cascade' }),
})

export const templates = appSchema.table(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    schema: jsonb('schema').$type<ProjectSchema>().notNull(),
    isOfficial: boolean('is_official').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [uniqueIndex('templates_slug_uidx').on(table.slug)],
)

export const userSettings = appSchema.table('user_settings', {
  userId: uuid('user_id').primaryKey(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
export const agentRunCosts = appSchema.table(
  'agent_run_costs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    turnId: text('turn_id').notNull(),
    inputDigest: text('input_digest').notNull(),
    operationId: text('operation_id'),
    provider: text('provider'),
    model: text('model'),
    profile: text('profile'),
    state: text('state').$type<'reserved' | 'settled' | 'released'>().notNull(),
    accuracy: text('accuracy').$type<'actual' | 'estimated' | 'billing_indeterminate'>(),
    reservedMicros: integer('reserved_micros').notNull(),
    settledMicros: integer('settled_micros').notNull().default(0),
    minimumMicros: integer('minimum_micros'),
    maximumMicros: integer('maximum_micros'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    traceId: text('trace_id'),
    decisionOutput: jsonb('decision_output').$type<Record<string, unknown>>(),
    decisionUsage: jsonb('decision_usage').$type<Record<string, unknown>>(),
    decisionTrace: jsonb('decision_trace').$type<Record<string, unknown>>(),
    billingScope: text('billing_scope').$type<'project' | 'user'>().notNull(),
    payerId: uuid('payer_id').notNull(),
    reservationExpiresAt: timestamp('reservation_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('agent_run_costs_actor_project_turn_uidx').on(table.actorId, table.projectId, table.turnId),
    index('agent_run_costs_actor_project_task_idx').on(table.actorId, table.projectId, table.taskId),
    index('agent_run_costs_project_created_idx').on(table.projectId, table.createdAt),
    index('agent_run_costs_payer_month_idx').on(table.billingScope, table.payerId, table.createdAt),
  ],
)

export const agentRunDispatches = appSchema.table(
  'agent_run_dispatches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').notNull(),
    taskId: text('task_id').notNull(),
    operationId: text('operation_id').notNull(),
    kind: text('kind').$type<'initial' | 'run'>().notNull().default('run'),
    waitingReason: text('waiting_reason').$type<'upload' | 'user'>(),
    turnId: text('turn_id'),
    inputDigest: text('input_digest'),
    inputSnapshot: jsonb('input_snapshot').$type<Record<string, unknown>>(),
    phase: text('phase').$type<'waiting_input' | 'planning' | 'executing' | 'terminal'>(),
    frozenProvider: text('frozen_provider'),
    frozenModel: text('frozen_model'),
    frozenProfile: text('frozen_profile'),
    frozenConfigDigest: text('frozen_config_digest'),
    billingScope: text('billing_scope').$type<'project' | 'user'>(),
    payerId: uuid('payer_id'),
    taskLimitMicros: integer('task_limit_micros'),
    projectLimitMicros: integer('project_limit_micros'),
    warningRatio: numeric('warning_ratio', { mode: 'number' }),
    providerIdempotency: text('provider_idempotency').$type<'unsupported' | 'stable'>(),
    state: text('state')
      .$type<'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'canceled' | 'indeterminate'>()
      .notNull()
      .default('queued'),
    desiredState: text('desired_state').$type<'running' | 'paused' | 'canceled'>().notNull().default('running'),
    generation: integer('generation').notNull().default(0),
    leaseOwner: text('lease_owner'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  table => [
    uniqueIndex('agent_run_dispatches_actor_operation_uidx').on(table.actorId, table.operationId),
    uniqueIndex('agent_run_dispatches_actor_project_turn_uidx').on(table.actorId, table.projectId, table.turnId),
    index('agent_run_dispatches_project_task_idx').on(table.projectId, table.taskId, table.createdAt),
    index('agent_run_dispatches_claim_idx').on(table.desiredState, table.state, table.leaseUntil, table.createdAt),
  ],
)

export const agentProviderAttempts = appSchema.table(
  'agent_provider_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    dispatchId: uuid('dispatch_id')
      .notNull()
      .references(() => agentRunDispatches.id, { onDelete: 'cascade' }),
    dispatchGeneration: integer('dispatch_generation').notNull(),
    dispatchWorkerId: text('dispatch_worker_id').notNull(),
    attemptNo: integer('attempt_no').notNull(),
    providerRequestKey: text('provider_request_key'),
    requestBodyDigest: text('request_body_digest').notNull(),
    state: text('state')
      .$type<'prepared' | 'started' | 'succeeded' | 'failed_definite' | 'outcome_unknown'>()
      .notNull()
      .default('prepared'),
    reservationDeltaMicros: integer('reservation_delta_micros').notNull().default(0),
    costAccuracy: text('cost_accuracy').$type<'actual' | 'estimated' | 'billing_indeterminate'>(),
    amountMicros: integer('amount_micros'),
    minimumMicros: integer('minimum_micros'),
    maximumMicros: integer('maximum_micros'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    cachedTokens: integer('cached_tokens'),
    durationMs: integer('duration_ms'),
    upstreamRequestId: text('upstream_request_id'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('agent_provider_attempts_dispatch_attempt_uidx').on(table.dispatchId, table.attemptNo),
    index('agent_provider_attempts_dispatch_idx').on(table.dispatchId, table.attemptNo),
  ],
)

export const schema = {
  spaces,
  spaceMembers,
  projects,
  projectFavorites,
  projectThumbnailArtifacts,
  projectRevisions,
  agentAssets,
  agentSpikeOperations,
  agentWorkspaces,
  agentProjectContexts,
  projectPublishSnapshots,
  projectPreviewRuns,
  projectPublishApprovals,
  projectPublications,
  projectReleases,
  templates,
  userSettings,
  agentRunCosts,
  agentRunDispatches,
  agentProviderAttempts,
}
