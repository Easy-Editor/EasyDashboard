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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
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
