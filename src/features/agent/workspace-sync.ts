import { ApiError } from '@/api/client'
import {
  createEmptyAgentWorkspace,
  decodeAgentWorkspace,
  readAgentWorkspace,
  replaceAgentWorkspace,
  subscribeAgentWorkspace,
} from './store'
import type {
  AgentAttachment,
  AgentConversation,
  AgentMessage,
  AgentProjectContext,
  AgentProjectContextTombstone,
  AgentProjectWorkspacePayload,
  AgentStorage,
  AgentTask,
  AgentTaskStage,
  AgentWorkspace,
  AgentWorkspaceListener,
  AgentWorkspaceRemoteRecord,
} from './types'
import {
  type PutAgentWorkspaceInput,
  getAgentProjectWorkspace,
  isAgentWorkspaceRevisionConflict,
  putAgentProjectWorkspace,
} from './workspace-api'

export type AgentWorkspaceTransport = {
  get(projectId: string): Promise<AgentWorkspaceRemoteRecord | null>
  put(projectId: string, input: PutAgentWorkspaceInput): Promise<AgentWorkspaceRemoteRecord>
}

export type AgentWorkspaceSyncResult = {
  workspace: AgentWorkspace
  project: AgentProjectWorkspacePayload
  revision?: number
  status: 'synced' | 'remote' | 'local-offline'
}

export type AgentWorkspaceSync = {
  hydrate(): Promise<AgentWorkspaceSyncResult>
  persist(): Promise<AgentWorkspaceSyncResult>
  subscribe(listener: AgentWorkspaceListener): () => void
}

export type AgentWorkspaceConnectionStatus = 'hydrating' | 'synced' | 'saving' | 'offline' | 'error'

const defaultTransport: AgentWorkspaceTransport = {
  get: getAgentProjectWorkspace,
  put: putAgentProjectWorkspace,
}

const MAX_AGENT_WORKSPACE_CAS_ATTEMPTS = 3

function time(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

function sortByCreatedAt<T extends { id: string; createdAt: string }>(values: T[]): T[] {
  return values.sort(
    (first, second) => time(first.createdAt) - time(second.createdAt) || first.id.localeCompare(second.id),
  )
}

function newerUpdatedEntity<T extends { updatedAt: string }>(first: T, second: T): T {
  if (time(first.updatedAt) !== time(second.updatedAt)) {
    return time(first.updatedAt) > time(second.updatedAt) ? first : second
  }
  return JSON.stringify(first).localeCompare(JSON.stringify(second)) <= 0 ? first : second
}

function deterministicEntity<T>(first: T, second: T): T {
  return JSON.stringify(first).localeCompare(JSON.stringify(second)) <= 0 ? first : second
}

function newerCreatedEntity<T extends { createdAt: string }>(first: T, second: T): T {
  if (time(first.createdAt) !== time(second.createdAt)) {
    return time(first.createdAt) > time(second.createdAt) ? first : second
  }
  return deterministicEntity(first, second)
}

function mergeAttachment(first: AgentAttachment, second: AgentAttachment): AgentAttachment {
  return structuredClone(newerCreatedEntity(first, second))
}

function mergeMessage(first: AgentMessage, second: AgentMessage): AgentMessage {
  const firstIdentity = { ...first, attachments: [] }
  const secondIdentity = { ...second, attachments: [] }
  const preferred = newerCreatedEntity(firstIdentity, secondIdentity) === firstIdentity ? first : second
  return {
    ...structuredClone(preferred),
    attachments: sortByCreatedAt(mergeEntities(first.attachments, second.attachments, mergeAttachment)),
  }
}

const taskStageStatusRank: Record<AgentTaskStage['status'], number> = {
  pending: 0,
  waiting: 1,
  running: 2,
  complete: 3,
  failed: 3,
}

const taskStageOrder: Record<AgentTaskStage['id'], number> = {
  'understand-requirements': 0,
  'plan-layout': 1,
  'bind-data': 2,
  'preview-check': 3,
}

function mergeTaskStage(
  first: AgentTaskStage,
  second: AgentTaskStage,
  preferFirst: boolean,
  replaceOlderRunningStage: boolean,
): AgentTaskStage {
  const latest = preferFirst ? first : second
  const earlier = preferFirst ? second : first
  if (replaceOlderRunningStage && earlier.status === 'running') return structuredClone(latest)
  const firstRank = taskStageStatusRank[first.status]
  const secondRank = taskStageStatusRank[second.status]
  const preferred = firstRank === secondRank ? (preferFirst ? first : second) : firstRank > secondRank ? first : second
  return structuredClone(preferred)
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function mergeEvidence(earlier: unknown, latest: unknown): unknown {
  if (latest === undefined) return structuredClone(earlier)
  if (earlier === undefined) return structuredClone(latest)
  const earlierRecord = recordValue(earlier)
  const latestRecord = recordValue(latest)
  if (!earlierRecord || !latestRecord) return structuredClone(latest)
  const merged: Record<string, unknown> = structuredClone(earlierRecord)
  for (const [key, value] of Object.entries(latestRecord)) {
    merged[key] = mergeEvidence(earlierRecord[key], value)
  }
  return merged
}

function mergeTaskRun(earlier: AgentTask['run'], latest: AgentTask['run']): AgentTask['run'] {
  if (!latest) return earlier ? structuredClone(earlier) : undefined
  if (!earlier || earlier.operationId !== latest.operationId) return structuredClone(latest)
  const trace = latest.trace
    ? {
        ...structuredClone(earlier.trace),
        ...structuredClone(latest.trace),
        skills: [...new Set([...(earlier.trace?.skills ?? []), ...latest.trace.skills])].sort(),
      }
    : structuredClone(earlier.trace)
  return {
    ...structuredClone(earlier),
    ...structuredClone(latest),
    ...(earlier.outcome === undefined && latest.outcome === undefined
      ? {}
      : { outcome: mergeEvidence(earlier.outcome, latest.outcome) }),
    ...(earlier.receipt === undefined && latest.receipt === undefined
      ? {}
      : { receipt: mergeEvidence(earlier.receipt, latest.receipt) }),
    ...(earlier.cost === undefined && latest.cost === undefined
      ? {}
      : { cost: mergeEvidence(earlier.cost, latest.cost) as NonNullable<AgentTask['run']>['cost'] }),
    ...(trace ? { trace } : {}),
    ...(earlier.rollback === undefined && latest.rollback === undefined
      ? {}
      : { rollback: mergeEvidence(earlier.rollback, latest.rollback) }),
    ...(earlier.rollbackReceipt === undefined && latest.rollbackReceipt === undefined
      ? {}
      : { rollbackReceipt: mergeEvidence(earlier.rollbackReceipt, latest.rollbackReceipt) }),
  }
}

function newerTask(first: AgentTask, second: AgentTask): AgentTask {
  const latest = newerUpdatedEntity(first, second)
  const earlier = latest === first ? second : first
  const preferFirstStage = latest === first
  const replaceOlderRunningStage =
    latest.status === 'waiting_user' || latest.status === 'paused' || latest.status === 'canceled'
  const run = mergeTaskRun(earlier.run, latest.run)
  const usage =
    earlier.usage || latest.usage ? { ...structuredClone(earlier.usage), ...structuredClone(latest.usage) } : undefined
  return {
    ...structuredClone(latest),
    stages: mergeEntities(first.stages, second.stages, (firstStage, secondStage) =>
      mergeTaskStage(firstStage, secondStage, preferFirstStage, replaceOlderRunningStage),
    ).sort((firstStage, secondStage) => taskStageOrder[firstStage.id] - taskStageOrder[secondStage.id]),
    ...(usage ? { usage } : {}),
    ...(run ? { run } : {}),
  }
}

function mergeConversation(first: AgentConversation, second: AgentConversation): AgentConversation {
  const latest = newerUpdatedEntity(first, second)
  return {
    ...structuredClone(latest),
    messages: sortByCreatedAt(mergeEntities(first.messages, second.messages, mergeMessage)),
    tasks: sortByCreatedAt(mergeEntities(first.tasks, second.tasks, newerTask)),
  }
}

function newerContext(first: AgentProjectContext, second: AgentProjectContext): AgentProjectContext {
  if (first.revision !== second.revision) return first.revision > second.revision ? first : second
  if (time(first.updatedAt) === time(second.updatedAt)) return first.id.localeCompare(second.id) <= 0 ? first : second
  return time(first.updatedAt) > time(second.updatedAt) ? first : second
}

function newerTombstone(
  first: AgentProjectContextTombstone,
  second: AgentProjectContextTombstone,
): AgentProjectContextTombstone {
  if (time(first.deletedAt) === time(second.deletedAt)) return first.id.localeCompare(second.id) <= 0 ? first : second
  return time(first.deletedAt) > time(second.deletedAt) ? first : second
}

function mergeEntities<T extends { id: string }>(
  first: readonly T[],
  second: readonly T[],
  choose: (first: T, second: T) => T,
): T[] {
  const merged = new Map(first.map(item => [item.id, structuredClone(item)]))
  for (const item of second) {
    const existing = merged.get(item.id)
    merged.set(item.id, structuredClone(existing ? choose(existing, item) : item))
  }
  return [...merged.values()]
}

export function sliceAgentWorkspaceByProject(
  workspace: AgentWorkspace,
  projectId: string,
): AgentProjectWorkspacePayload {
  return {
    version: 1,
    ownerUserId: workspace.ownerUserId,
    projectId,
    conversations: sortByCreatedAt(
      workspace.conversations
        .filter(conversation => conversation.projectId === projectId)
        .map(conversation => structuredClone(conversation)),
    ),
    projectContexts: sortByCreatedAt(
      workspace.projectContexts
        .filter(context => context.projectId === projectId)
        .map(context => structuredClone(context)),
    ),
    projectContextTombstones: workspace.projectContextTombstones
      .filter(tombstone => tombstone.projectId === projectId)
      .map(tombstone => structuredClone(tombstone))
      .sort((first, second) => time(first.deletedAt) - time(second.deletedAt) || first.id.localeCompare(second.id)),
  }
}

export function decodeAgentProjectWorkspacePayload(
  value: unknown,
  ownerUserId: string,
  projectId: string,
): AgentProjectWorkspacePayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid Agent project workspace payload')
  const candidate = value as Partial<AgentProjectWorkspacePayload>
  if (candidate.version !== 1 || candidate.ownerUserId !== ownerUserId || candidate.projectId !== projectId) {
    throw new Error('Agent project workspace identity mismatch')
  }
  const workspace = decodeAgentWorkspace(
    {
      ...createEmptyAgentWorkspace(ownerUserId),
      conversations: candidate.conversations,
      projectContexts: candidate.projectContexts,
      projectContextTombstones: candidate.projectContextTombstones,
    },
    ownerUserId,
  )
  if (
    workspace.conversations.some(conversation => conversation.projectId !== projectId) ||
    workspace.projectContexts.some(context => context.projectId !== projectId) ||
    workspace.projectContextTombstones.some(tombstone => tombstone.projectId !== projectId)
  ) {
    throw new Error('Agent project workspace contains cross-project data')
  }
  return sliceAgentWorkspaceByProject(workspace, projectId)
}

function decodeRemoteProject(
  record: AgentWorkspaceRemoteRecord,
  ownerUserId: string,
  projectId: string,
): AgentProjectWorkspacePayload {
  if (
    record.ownerId !== ownerUserId ||
    record.projectId !== projectId ||
    !Number.isInteger(record.revision) ||
    record.revision < 1
  ) {
    throw new Error('Agent workspace record identity or revision mismatch')
  }
  return decodeAgentProjectWorkspacePayload(record.payload, ownerUserId, projectId)
}

export function mergeAgentProjectWorkspacePayloads(
  first: AgentProjectWorkspacePayload,
  second: AgentProjectWorkspacePayload,
): AgentProjectWorkspacePayload {
  if (first.ownerUserId !== second.ownerUserId || first.projectId !== second.projectId) {
    throw new Error('Cannot merge Agent workspaces with different identities')
  }
  const projectContextTombstones = mergeEntities(
    first.projectContextTombstones ?? [],
    second.projectContextTombstones ?? [],
    newerTombstone,
  )
  const deletedContextIds = new Set(projectContextTombstones.map(tombstone => tombstone.id))
  return {
    version: 1,
    ownerUserId: first.ownerUserId,
    projectId: first.projectId,
    conversations: sortByCreatedAt(mergeEntities(first.conversations, second.conversations, mergeConversation)),
    projectContexts: sortByCreatedAt(
      mergeEntities(first.projectContexts, second.projectContexts, newerContext).filter(
        context => !deletedContextIds.has(context.id),
      ),
    ),
    projectContextTombstones: projectContextTombstones.sort(
      (firstTombstone, secondTombstone) =>
        time(firstTombstone.deletedAt) - time(secondTombstone.deletedAt) ||
        firstTombstone.id.localeCompare(secondTombstone.id),
    ),
  }
}

export function hydrateAgentProjectWorkspace(
  workspace: AgentWorkspace,
  project: AgentProjectWorkspacePayload,
): AgentWorkspace {
  if (workspace.ownerUserId !== project.ownerUserId) throw new Error('Agent workspace owner mismatch')
  const localProject = sliceAgentWorkspaceByProject(workspace, project.projectId)
  const merged = mergeAgentProjectWorkspacePayloads(localProject, project)
  return {
    ...structuredClone(workspace),
    conversations: [
      ...workspace.conversations.filter(conversation => conversation.projectId !== project.projectId),
      ...merged.conversations,
    ],
    projectContexts: [
      ...workspace.projectContexts.filter(context => context.projectId !== project.projectId),
      ...merged.projectContexts,
    ],
    projectContextTombstones: [
      ...workspace.projectContextTombstones.filter(tombstone => tombstone.projectId !== project.projectId),
      ...(merged.projectContextTombstones ?? []),
    ],
  }
}

function samePayload(first: AgentProjectWorkspacePayload, second: AgentProjectWorkspacePayload): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

function offlineResult(workspace: AgentWorkspace, projectId: string, revision?: number): AgentWorkspaceSyncResult {
  return {
    workspace,
    project: sliceAgentWorkspaceByProject(workspace, projectId),
    ...(revision === undefined ? {} : { revision }),
    status: 'local-offline',
  }
}

function isAgentWorkspaceTransportFailure(error: unknown): boolean {
  if (error instanceof ApiError) return false
  return error instanceof TypeError
}

export async function syncAgentWorkspaceProject(input: {
  ownerUserId: string
  projectId: string
  storage?: AgentStorage
  transport?: AgentWorkspaceTransport
}): Promise<AgentWorkspaceSyncResult> {
  const { ownerUserId, projectId, storage, transport = defaultTransport } = input
  let localWorkspace = readAgentWorkspace(ownerUserId, storage)
  let localProject = sliceAgentWorkspaceByProject(localWorkspace, projectId)
  let remote: AgentWorkspaceRemoteRecord | null

  try {
    remote = await transport.get(projectId)
  } catch (error) {
    if (!isAgentWorkspaceTransportFailure(error)) throw error
    return offlineResult(readAgentWorkspace(ownerUserId, storage), projectId)
  }

  if (remote) {
    const remoteProject = decodeRemoteProject(remote, ownerUserId, projectId)
    localWorkspace = readAgentWorkspace(ownerUserId, storage)
    localProject = sliceAgentWorkspaceByProject(localWorkspace, projectId)
    localProject = mergeAgentProjectWorkspacePayloads(localProject, remoteProject)
    localWorkspace = hydrateAgentProjectWorkspace(localWorkspace, localProject)
    replaceAgentWorkspace(localWorkspace, storage)
    if (samePayload(localProject, remoteProject)) {
      return { workspace: localWorkspace, project: localProject, revision: remote.revision, status: 'remote' }
    }
  }

  localWorkspace = readAgentWorkspace(ownerUserId, storage)
  localProject = remote
    ? mergeAgentProjectWorkspacePayloads(sliceAgentWorkspaceByProject(localWorkspace, projectId), localProject)
    : sliceAgentWorkspaceByProject(localWorkspace, projectId)

  let expectedRevision = remote?.revision
  for (let attempt = 0; attempt < MAX_AGENT_WORKSPACE_CAS_ATTEMPTS; attempt += 1) {
    try {
      const saved = await transport.put(projectId, {
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
        payload: localProject,
      })
      const savedProject = decodeRemoteProject(saved, ownerUserId, projectId)
      const workspace = hydrateAgentProjectWorkspace(readAgentWorkspace(ownerUserId, storage), savedProject)
      replaceAgentWorkspace(workspace, storage)
      return {
        workspace,
        project: sliceAgentWorkspaceByProject(workspace, projectId),
        revision: saved.revision,
        status: 'synced',
      }
    } catch (error) {
      if (!isAgentWorkspaceRevisionConflict(error)) {
        if (!isAgentWorkspaceTransportFailure(error)) throw error
        return offlineResult(readAgentWorkspace(ownerUserId, storage), projectId, expectedRevision)
      }
      if (attempt === MAX_AGENT_WORKSPACE_CAS_ATTEMPTS - 1) throw error
    }

    let latest: AgentWorkspaceRemoteRecord | null
    try {
      latest = await transport.get(projectId)
    } catch (error) {
      if (!isAgentWorkspaceTransportFailure(error)) throw error
      return offlineResult(readAgentWorkspace(ownerUserId, storage), projectId, expectedRevision)
    }
    if (!latest) throw new Error('Agent workspace disappeared during conflict resolution')
    const latestProject = decodeRemoteProject(latest, ownerUserId, projectId)
    localWorkspace = readAgentWorkspace(ownerUserId, storage)
    localProject = mergeAgentProjectWorkspacePayloads(
      sliceAgentWorkspaceByProject(localWorkspace, projectId),
      latestProject,
    )
    localWorkspace = hydrateAgentProjectWorkspace(localWorkspace, localProject)
    replaceAgentWorkspace(localWorkspace, storage)
    expectedRevision = latest.revision
  }

  throw new Error('Agent workspace CAS retry budget was exhausted')
}

export function createAgentWorkspaceSync(input: {
  ownerUserId: string
  projectId: string
  storage?: AgentStorage
  transport?: AgentWorkspaceTransport
}): AgentWorkspaceSync {
  return {
    hydrate: () => syncAgentWorkspaceProject(input),
    persist: () => syncAgentWorkspaceProject(input),
    subscribe: listener => subscribeAgentWorkspace(input.ownerUserId, listener),
  }
}

export function connectAgentWorkspaceSync(input: {
  ownerUserId: string
  projectId: string
  storage?: AgentStorage
  transport?: AgentWorkspaceTransport
  debounceMs?: number
  onStatus?: (status: AgentWorkspaceConnectionStatus) => void
  onWorkspace?: AgentWorkspaceListener
}): () => void {
  const sync = createAgentWorkspaceSync(input)
  let stopped = false
  let syncing = false
  let dirty = false
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let serializedProject = JSON.stringify(
    sliceAgentWorkspaceByProject(readAgentWorkspace(input.ownerUserId, input.storage), input.projectId),
  )
  const schedulePersist = () => {
    if (stopped || syncing) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void runSync('persist')
    }, input.debounceMs ?? 500)
  }
  const unsubscribe = sync.subscribe(workspace => {
    input.onWorkspace?.(workspace)
    const nextSerializedProject = JSON.stringify(sliceAgentWorkspaceByProject(workspace, input.projectId))
    if (nextSerializedProject === serializedProject) return
    serializedProject = nextSerializedProject
    generation += 1
    dirty = true
    schedulePersist()
  })
  const runSync = async (operation: 'hydrate' | 'persist') => {
    if (stopped || syncing) return
    syncing = true
    dirty = false
    const startedGeneration = generation
    input.onStatus?.(operation === 'hydrate' ? 'hydrating' : 'saving')
    let completed = false
    let retryAfterConflict = false
    try {
      const result = await sync[operation]()
      if (stopped) return
      input.onWorkspace?.(result.workspace)
      input.onStatus?.(result.status === 'local-offline' ? 'offline' : 'synced')
      completed = true
    } catch (error) {
      if (stopped) return
      retryAfterConflict = isAgentWorkspaceRevisionConflict(error)
      input.onStatus?.('error')
    } finally {
      syncing = false
      if ((completed && (dirty || generation !== startedGeneration)) || retryAfterConflict) schedulePersist()
    }
  }
  void runSync('hydrate')
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}
