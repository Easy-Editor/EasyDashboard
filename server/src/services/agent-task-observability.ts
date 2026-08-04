export const agentTaskOperationalEventCodes = [
  'transition_reclaimed',
  'reconciliation_repeated',
  'transition_step_divergence',
  'duplicate_mutation_prevented',
  'unknown_commit_outcome',
  'budget_bypass',
  'transition_failed',
] as const

export type AgentTaskOperationalEventCode = (typeof agentTaskOperationalEventCodes)[number]
export type AgentTaskOperationalEventSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface AgentTaskOperationalEventContext {
  dedupeKey: string
  taskRunId: string
  projectId?: string | null
  transitionId?: string | null
  transitionKey?: string | null
  transitionKind?: string | null
  transitionGeneration?: number | null
  operationId?: string | null
  code: AgentTaskOperationalEventCode
  severity: AgentTaskOperationalEventSeverity
  details?: Readonly<Record<string, boolean | number | string | null>>
}

export interface AgentTaskOperationalEventStore {
  appendAgentTaskOperationalEvent(
    actorId: string,
    event: AgentTaskOperationalEventContext & { details: Record<string, boolean | number | string | null>; now: Date },
  ): Promise<unknown>
}

export interface AgentTaskOperationalEventLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

const allowedDetailKeys = new Set([
  'claimAttempts',
  'expiredLeaseCount',
  'reconciliationCount',
  'status',
  'transitionGeneration',
  'transitionKey',
  'transitionKind',
  'workerId',
])

function safeDetails(
  details: AgentTaskOperationalEventContext['details'],
): Record<string, boolean | number | string | null> {
  if (!details) return {}
  const safe: Record<string, boolean | number | string | null> = {}
  for (const [key, value] of Object.entries(details)) {
    if (!allowedDetailKeys.has(key)) continue
    if (typeof value !== 'string') {
      safe[key] = value
      continue
    }
    if (key === 'status' && ['pending', 'leased', 'completed', 'paused', 'terminal'].includes(value)) {
      safe[key] = value
    } else if (
      key === 'transitionKind' &&
      ['planning', 'step_action', 'observation', 'final_verification', 'rollback'].includes(value)
    ) {
      safe[key] = value
    } else if (key === 'transitionKey' && /^[a-zA-Z0-9._:-]{1,240}$/.test(value)) {
      safe[key] = value
    } else if (key === 'workerId' && /^[a-zA-Z0-9._:-]{1,120}$/.test(value)) {
      safe[key] = value
    }
  }
  return safe
}

export function createAgentTaskObservability(options: {
  store: AgentTaskOperationalEventStore
  now?: () => Date
  logger?: AgentTaskOperationalEventLogger
}) {
  const now = options.now ?? (() => new Date())
  const logger = options.logger ?? console

  const logDurable = (event: AgentTaskOperationalEventContext): void => {
    const details = safeDetails({
      ...event.details,
      transitionKey: event.transitionKey ?? null,
      transitionKind: event.transitionKind ?? null,
      transitionGeneration: event.transitionGeneration ?? null,
    })
    const projection = JSON.stringify({
      source: 'agent_task_loop',
      projectId: event.projectId ?? null,
      taskRunId: event.taskRunId,
      transitionId: event.transitionId ?? null,
      transitionKey: details.transitionKey ?? null,
      transitionKind: details.transitionKind ?? null,
      transitionGeneration: details.transitionGeneration ?? null,
      operationId: event.operationId ?? null,
      code: event.code,
      severity: event.severity,
      details,
    })
    if (event.severity === 'critical' || event.severity === 'error') logger.error(projection)
    else if (event.severity === 'warning') logger.warn(projection)
    else logger.info(projection)
  }

  return {
    logDurable,
    async record(actorId: string, event: AgentTaskOperationalEventContext): Promise<void> {
      const durable = {
        ...event,
        details: safeDetails({
          ...event.details,
          transitionKey: event.transitionKey ?? null,
          transitionKind: event.transitionKind ?? null,
          transitionGeneration: event.transitionGeneration ?? null,
        }),
        now: now(),
      }
      await options.store.appendAgentTaskOperationalEvent(actorId, durable)
      logDurable({ ...event, details: durable.details })
    },
  }
}

export type AgentTaskObservability = ReturnType<typeof createAgentTaskObservability>
