import { createHash } from 'node:crypto'

export type CostAccuracy = 'actual' | 'estimated' | 'billing_indeterminate'
export type BudgetState = 'ok' | 'warning' | 'hard_stop'

export interface CostAmount {
  currency: 'USD'
  micros: number
  accuracy: CostAccuracy
  minimumMicros?: number
  maximumMicros?: number
}

export interface CostLedgerEntry {
  requestId: string
  requestDigest: string
  projectId: string
  conversationId: string
  taskId: string
  stageId: string
  provider: string
  model: string
  billingScope: 'project' | 'user'
  payerId: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  durationMs: number
  attempts: number
  amount: CostAmount
  relatedRequestId: string | null
  createdAt: string
}

export interface BudgetLimit {
  taskMicros: number
  projectMonthMicros: number
  warningRatio: number
}

export interface BudgetUsage {
  taskSettledMicros: number
  taskReservedMicros: number
  projectMonthSettledMicros: number
  projectMonthReservedMicros: number
}

export interface BudgetReservation {
  requestId: string
  taskId: string
  projectId: string
  reservedMicros: number
  state: Exclude<BudgetState, 'hard_stop'>
  createdAt: string
}

export type LedgerRecordResult =
  | { kind: 'recorded'; entries: CostLedgerEntry[] }
  | { kind: 'duplicate'; entries: CostLedgerEntry[]; entry: CostLedgerEntry }
  | { kind: 'conflict'; entries: CostLedgerEntry[]; entry: CostLedgerEntry }

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

export function costRequestDigest(input: Omit<CostLedgerEntry, 'requestDigest' | 'createdAt'>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

export function validateCostAmount(amount: CostAmount): void {
  if (!isNonNegativeInteger(amount.micros)) throw new Error('Cost amount must be a non-negative integer')
  if (amount.accuracy === 'billing_indeterminate') {
    if (
      !isNonNegativeInteger(amount.minimumMicros ?? -1) ||
      !isNonNegativeInteger(amount.maximumMicros ?? -1) ||
      (amount.minimumMicros ?? 0) > (amount.maximumMicros ?? 0)
    ) {
      throw new Error('Indeterminate billing must preserve a valid possible cost range')
    }
  }
}

export function recordCostEntry(entries: readonly CostLedgerEntry[], candidate: CostLedgerEntry): LedgerRecordResult {
  validateCostAmount(candidate.amount)
  const existing = entries.find(entry => entry.requestId === candidate.requestId)
  if (!existing) return { kind: 'recorded', entries: [...entries, candidate] }
  if (existing.requestDigest === candidate.requestDigest) {
    return { kind: 'duplicate', entries: [...entries], entry: existing }
  }
  return { kind: 'conflict', entries: [...entries], entry: existing }
}

function budgetState(used: number, limit: number, warningRatio: number): BudgetState {
  if (used >= limit) return 'hard_stop'
  if (used >= Math.floor(limit * warningRatio)) return 'warning'
  return 'ok'
}

export function reserveBudget(input: {
  requestId: string
  taskId: string
  projectId: string
  estimatedMicros: number
  limit: BudgetLimit
  usage: BudgetUsage
  now?: string
}): { state: BudgetState; reservation: BudgetReservation | null; reason?: 'TASK_LIMIT' | 'PROJECT_LIMIT' } {
  const { estimatedMicros, limit, usage } = input
  if (!isNonNegativeInteger(estimatedMicros)) throw new Error('Budget estimate must be a non-negative integer')
  if (
    !isNonNegativeInteger(limit.taskMicros) ||
    !isNonNegativeInteger(limit.projectMonthMicros) ||
    limit.taskMicros === 0 ||
    limit.projectMonthMicros === 0 ||
    !Number.isFinite(limit.warningRatio) ||
    limit.warningRatio <= 0 ||
    limit.warningRatio >= 1
  ) {
    throw new Error('Budget limits are invalid')
  }
  const taskTotal = usage.taskSettledMicros + usage.taskReservedMicros + estimatedMicros
  const projectTotal = usage.projectMonthSettledMicros + usage.projectMonthReservedMicros + estimatedMicros
  if (taskTotal > limit.taskMicros) return { state: 'hard_stop', reservation: null, reason: 'TASK_LIMIT' }
  if (projectTotal > limit.projectMonthMicros) return { state: 'hard_stop', reservation: null, reason: 'PROJECT_LIMIT' }
  const state =
    budgetState(projectTotal, limit.projectMonthMicros, limit.warningRatio) === 'warning' ||
    budgetState(taskTotal, limit.taskMicros, limit.warningRatio) === 'warning'
      ? 'warning'
      : 'ok'
  return {
    state,
    reservation: {
      requestId: input.requestId,
      taskId: input.taskId,
      projectId: input.projectId,
      reservedMicros: estimatedMicros,
      state,
      createdAt: input.now ?? new Date().toISOString(),
    },
  }
}

export function settleReservation(
  reservation: BudgetReservation,
  amount: CostAmount,
): { reservedMicrosReleased: number; settledMicros: number; accuracy: CostAccuracy } {
  validateCostAmount(amount)
  return {
    reservedMicrosReleased: reservation.reservedMicros,
    settledMicros:
      amount.accuracy === 'billing_indeterminate' ? (amount.maximumMicros ?? amount.micros) : amount.micros,
    accuracy: amount.accuracy,
  }
}
