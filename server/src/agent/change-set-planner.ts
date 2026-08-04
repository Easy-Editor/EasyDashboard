import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  type ScreenApplyChangeSetInvocation,
  screenApplyChangeSetInvocationSchema,
  screenOperationSchema,
} from './executor-contract.js'

export const MAX_AGENT_PLANNED_OPERATIONS = 48

const opIdLessOperationSchema = z.discriminatedUnion('type', [
  screenOperationSchema.options[0].omit({ opId: true }),
  screenOperationSchema.options[1].omit({ opId: true }),
  screenOperationSchema.options[2].omit({ opId: true }),
  screenOperationSchema.options[3].omit({ opId: true }),
  screenOperationSchema.options[4].omit({ opId: true }),
  screenOperationSchema.options[5].omit({ opId: true }),
  screenOperationSchema.options[6].omit({ opId: true }),
])

export type AgentPlannedOperationType = z.infer<typeof opIdLessOperationSchema>['type']

const decisionMessageSchema = z.string().trim().min(1).max(2_000)
const decisionPlanSchema = z.array(z.string().trim().min(1).max(500)).min(1).max(12)

export const agentAskUserDecisionSchema = z
  .object({
    action: z.literal('ask_user'),
    message: decisionMessageSchema,
    question: z
      .object({
        id: z.string().trim().min(1).max(160),
        text: z.string().trim().min(1).max(1_000),
      })
      .strict(),
    plan: decisionPlanSchema.optional(),
  })
  .strict()

export const agentExecuteDecisionSchema = z
  .object({
    action: z.literal('execute'),
    summary: decisionMessageSchema,
    plan: decisionPlanSchema,
    operations: z.array(opIdLessOperationSchema).min(1).max(MAX_AGENT_PLANNED_OPERATIONS),
  })
  .strict()

export const agentChangeSetDecisionSchema = z.discriminatedUnion('action', [
  agentAskUserDecisionSchema,
  agentExecuteDecisionSchema,
])

export const agentChangeSetModelOutputSchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const output = value as Record<string, unknown>
  if ('action' in output || typeof output.summary !== 'string' || !Array.isArray(output.operations)) return value
  return {
    ...output,
    action: 'execute',
    plan: output.plan ?? [output.summary],
  }
}, agentChangeSetDecisionSchema)

export type AgentAskUserDecision = z.infer<typeof agentAskUserDecisionSchema>
export type AgentExecuteDecision = z.infer<typeof agentExecuteDecisionSchema>
export type AgentChangeSetDecision = z.infer<typeof agentChangeSetDecisionSchema>
export type AgentChangeSetModelOutput = z.infer<typeof agentChangeSetModelOutputSchema>

export interface AgentChangeSetPlanningOptions {
  immutableNodeIds?: readonly string[]
  allowedOperationTypes?: readonly AgentPlannedOperationType[]
  document?: unknown
  requireRemove?: boolean
  /** Server-owned identities for deterministic transition/attempt replay. */
  identities?: {
    sessionId: string
    stepId: string
    callId: string
    opIds: readonly string[]
  }
}

type PlannedOperation = z.infer<typeof opIdLessOperationSchema>

const safeDataPathSegmentSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(value => !['__proto__', 'prototype', 'constructor'].includes(value), 'Unsafe data path segment')
const safeDataPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    value => value.split('.').every(segment => safeDataPathSegmentSchema.safeParse(segment).success),
    'Unsafe data path',
  )
const fieldMappingSchema = z
  .object({
    componentField: safeDataPathSchema,
    sourceField: safeDataPathSchema,
  })
  .strict()
const sharedDataConfigFields = {
  dataPath: safeDataPathSchema.optional(),
  fieldMappings: z.array(fieldMappingSchema).max(128).optional(),
}
const dataConfigSchema = z.discriminatedUnion('sourceType', [
  z
    .object({
      sourceType: z.literal('static'),
      staticData: z.array(z.json()).max(10_000),
      fieldMappings: sharedDataConfigFields.fieldMappings,
    })
    .strict(),
  z
    .object({
      sourceType: z.literal('global'),
      datasourceId: z.string().trim().min(1).max(160),
      ...sharedDataConfigFields,
    })
    .strict(),
  z
    .object({
      sourceType: z.literal('datasource'),
      datasourceId: z.string().trim().min(1).max(160),
      ...sharedDataConfigFields,
    })
    .strict(),
])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function dataSourceIds(value: unknown): Set<string> {
  const source = record(value)
  const list = Array.isArray(source?.list) ? source.list : []
  return new Set(
    list.flatMap(item => {
      const id = record(item)?.id
      return typeof id === 'string' && id.trim() ? [id] : []
    }),
  )
}

function documentDataSourceScopes(document: unknown): {
  global: Set<string>
  component: Map<string, Set<string>>
} {
  const global = new Set<string>()
  const component = new Map<string, Set<string>>()
  const visited = new Set<Record<string, unknown>>()

  const visitNode = (value: unknown, isRoot = false): void => {
    const node = record(value)
    if (!node || visited.has(node)) return
    visited.add(node)
    const id = typeof node.id === 'string' && node.id.trim() ? node.id : null
    const ids = dataSourceIds(node.dataSource)
    if (isRoot || node.isRoot === true || node.componentName === 'Root') ids.forEach(sourceId => global.add(sourceId))
    else if (id && ids.size > 0) component.set(id, ids)
    if (Array.isArray(node.children)) node.children.forEach(child => visitNode(child, false))
  }

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const candidate = record(value)
    if (!candidate || visited.has(candidate)) return
    dataSourceIds(candidate.dataSource).forEach(sourceId => global.add(sourceId))
    if (Array.isArray(candidate.componentsTree)) {
      candidate.componentsTree.forEach(node => visitNode(node, true))
    }
    for (const [key, child] of Object.entries(candidate)) {
      if (key !== 'componentsTree' && key !== 'dataSource') visit(child)
    }
  }

  visit(document)
  return { global, component }
}

function validateExistingDataSourceBindings(operations: PlannedOperation[], document: unknown): void {
  const scopes = documentDataSourceScopes(document)
  for (const operation of operations) {
    if ((operation.type === 'set' || operation.type === 'unset') && operation.fieldId === 'dataSource') {
      throw new Error('Agent cannot create or modify data source definitions; it may only bind existing sources')
    }
    const rawConfig =
      operation.type === 'set' && operation.fieldId === 'data.config'
        ? operation.value
        : operation.type === 'insert'
          ? operation.fields?.['data.config']
          : undefined
    if (rawConfig === undefined) continue
    const config = dataConfigSchema.parse(rawConfig)
    if (config.sourceType === 'static') continue
    if (config.sourceType === 'global') {
      if (!scopes.global.has(config.datasourceId)) {
        throw new Error(`Agent cannot bind unknown global data source ${config.datasourceId}`)
      }
      continue
    }
    if (operation.type === 'insert') {
      throw new Error('Agent cannot bind a component-scoped data source while inserting a new node')
    }
    if (!scopes.component.get(operation.nodeId)?.has(config.datasourceId)) {
      throw new Error(`Agent cannot bind data source ${config.datasourceId} outside node ${operation.nodeId}`)
    }
  }
}

function documentSubtrees(document: unknown): Map<string, Set<string>> {
  const subtrees = new Map<string, Set<string>>()
  const visited = new Set<Record<string, unknown>>()

  const visitNode = (value: unknown): Set<string> => {
    const node = record(value)
    if (!node || visited.has(node)) return new Set()
    visited.add(node)

    const nodeId = typeof node.id === 'string' && node.id.trim() ? node.id : null
    const subtree = new Set<string>(nodeId ? [nodeId] : [])
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        for (const descendantId of visitNode(child)) subtree.add(descendantId)
      }
    }
    if (nodeId) subtrees.set(nodeId, subtree)
    return subtree
  }

  const findTrees = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(findTrees)
      return
    }
    const candidate = record(value)
    if (!candidate) return
    if (Array.isArray(candidate.componentsTree)) candidate.componentsTree.forEach(visitNode)
    for (const [key, child] of Object.entries(candidate)) {
      if (key !== 'componentsTree') findTrees(child)
    }
  }

  findTrees(document)
  return subtrees
}

function operationReferences(operation: PlannedOperation): string[] {
  const references: string[] = []
  if ('nodeId' in operation) references.push(operation.nodeId)
  if ('parentId' in operation) references.push(operation.parentId)
  if ('position' in operation && operation.position && 'siblingId' in operation.position) {
    references.push(operation.position.siblingId)
  }
  return references
}

/**
 * A model occasionally proposes deleting a container in the same batch that
 * continues to resize or populate that container. The executor correctly
 * rejects the later child references as UNKNOWN_NODE, but the whole otherwise
 * useful refinement is then lost. Conservatively keep the edited structure and
 * discard only the contradictory destructive operation. Independent removals
 * requested by the user remain untouched.
 */
function withoutContradictoryRemovals(operations: PlannedOperation[], document: unknown): PlannedOperation[] {
  const subtrees = documentSubtrees(document)
  if (subtrees.size === 0 || !operations.some(operation => operation.type === 'remove')) return operations

  const nonRemoveReferences = new Set(
    operations.filter(operation => operation.type !== 'remove').flatMap(operationReferences),
  )
  const conflictingRemoveIds = new Set(
    operations.flatMap(operation => {
      if (operation.type !== 'remove') return []
      const subtree = subtrees.get(operation.nodeId) ?? new Set([operation.nodeId])
      return [...subtree].some(nodeId => nonRemoveReferences.has(nodeId)) ? [operation.nodeId] : []
    }),
  )

  const keptRemoveIds = new Set<string>()
  return operations.filter(operation => {
    if (operation.type !== 'remove') return true
    if (conflictingRemoveIds.has(operation.nodeId)) return false
    if (keptRemoveIds.has(operation.nodeId)) return false
    const alreadyRemovedByAncestor = [...keptRemoveIds].some(
      removedNodeId => subtrees.get(removedNodeId)?.has(operation.nodeId) ?? false,
    )
    if (alreadyRemovedByAncestor) return false
    keptRemoveIds.add(operation.nodeId)
    return true
  })
}

/**
 * Validates authority-free model output and mints every invocation identifier
 * on the server. The model can propose edits but cannot mint a call, session,
 * operation, or document authority.
 */
export function planStrictChangeSet(
  value: unknown,
  documentId: string,
  options: AgentChangeSetPlanningOptions = {},
): ScreenApplyChangeSetInvocation {
  const parsed = agentExecuteDecisionSchema.parse(agentChangeSetModelOutputSchema.parse(value))
  const operations = options.document
    ? withoutContradictoryRemovals(parsed.operations, options.document)
    : parsed.operations
  if (options.document) validateExistingDataSourceBindings(operations, options.document)
  if (options.requireRemove && !operations.some(operation => operation.type === 'remove')) {
    throw new Error('Agent output must include a remove operation for an explicit delete request')
  }
  const allowedOperationTypes = options.allowedOperationTypes ? new Set(options.allowedOperationTypes) : null
  const unauthorizedOperation = allowedOperationTypes
    ? operations.find(operation => !allowedOperationTypes.has(operation.type))
    : undefined
  if (unauthorizedOperation) {
    throw new Error(`Agent operation ${unauthorizedOperation.type} is not authorized for the current document state`)
  }
  const immutableNodeIds = new Set([documentId, ...(options.immutableNodeIds ?? [])])
  const protectedRootMutation = operations.find(
    operation =>
      (operation.type === 'remove' ||
        operation.type === 'move' ||
        operation.type === 'resize' ||
        operation.type === 'reorder') &&
      immutableNodeIds.has(operation.nodeId),
  )
  if (protectedRootMutation) {
    throw new Error(`Agent cannot ${protectedRootMutation.type} the immutable Root document node`)
  }
  const identities = options.identities
    ? {
        sessionId: options.identities.sessionId,
        stepId: options.identities.stepId,
        callId: options.identities.callId,
        opIds: [...options.identities.opIds],
      }
    : {
        sessionId: `session-${randomUUID()}`,
        stepId: `step-${randomUUID()}`,
        callId: `call-${randomUUID()}`,
        opIds: operations.map(() => `op-${randomUUID()}`),
      }
  if (identities.opIds.length !== operations.length) {
    throw new Error('Deterministic ChangeSet identity count must match planned operations')
  }
  return screenApplyChangeSetInvocationSchema.parse({
    sessionId: identities.sessionId,
    stepId: identities.stepId,
    callId: identities.callId,
    capability: 'screen.applyChangeSet',
    arguments: {
      schemaVersion: 1,
      documentId,
      operations: operations.map((operation, index) => ({ ...operation, opId: identities.opIds[index]! })),
    },
  })
}

export function parseStrictChangeSet(value: unknown): ScreenApplyChangeSetInvocation {
  return screenApplyChangeSetInvocationSchema.parse(value)
}
