import type { AgentTaskReconciliationClassification } from '../types.js'
import type { AgentTaskObservability } from './agent-task-observability.js'

export interface ReconciledAgentTaskTransition {
  id: string
  actorId: string
  projectId?: string
  taskRunId: string
  transitionKey: string
  kind: string
  generation: number
  leaseGeneration?: number
  claimAttempts: number
}

export interface AgentTaskReconciliationResult {
  transition: ReconciledAgentTaskTransition
  classification: AgentTaskReconciliationClassification
}

export interface AgentTaskReconciliationStore {
  reconcileAgentTaskTransitions(now: Date, limit: number): Promise<AgentTaskReconciliationResult[]>
}

export function createAgentTaskReconciler(options: {
  store: AgentTaskReconciliationStore
  observability: AgentTaskObservability
  workerId: string
  now?: () => Date
  limit?: number
}) {
  const now = options.now ?? (() => new Date())
  const limit = options.limit ?? 100

  return {
    async runOnce(): Promise<number> {
      const reconciled = await options.store.reconcileAgentTaskTransitions(now(), limit)
      for (const result of reconciled) {
        const { transition } = result
        if (result.classification === 'provider_outcome_unknown_paused') {
          options.observability.logDurable({
            dedupeKey: `provider-outcome-unknown:${transition.id}`,
            taskRunId: transition.taskRunId,
            projectId: transition.projectId,
            transitionId: transition.id,
            transitionKey: transition.transitionKey,
            transitionKind: transition.kind,
            transitionGeneration: transition.generation,
            code: 'unknown_commit_outcome',
            severity: 'error',
            details: { claimAttempts: transition.claimAttempts, status: 'paused' },
          })
          continue
        }
        if (result.classification !== 'requeued') continue
        const reconciliationGeneration = transition.leaseGeneration ?? transition.generation
        await options.observability.record(transition.actorId, {
          dedupeKey: `transition-reclaimed:${transition.id}:${reconciliationGeneration}`,
          taskRunId: transition.taskRunId,
          projectId: transition.projectId,
          transitionId: transition.id,
          transitionKey: transition.transitionKey,
          transitionKind: transition.kind,
          transitionGeneration: transition.generation,
          code: transition.claimAttempts > 1 ? 'reconciliation_repeated' : 'transition_reclaimed',
          severity: transition.claimAttempts > 1 ? 'warning' : 'info',
          details: { claimAttempts: transition.claimAttempts, workerId: options.workerId },
        })
      }
      return reconciled.length
    },
  }
}

export type AgentTaskReconciler = ReturnType<typeof createAgentTaskReconciler>
