export const MAX_COST_MICROS = 2_147_483_647

export type CostLifecycle = 'reserved' | 'settled' | 'released'
export type CostAccuracy = 'actual' | 'estimated' | 'billing_indeterminate'

export type PublicCostAmount =
  | {
      lifecycle: Exclude<CostLifecycle, 'released'>
      accuracy: CostAccuracy
      amountMicros: number
      minimumMicros: number
      maximumMicros: number
      estimateInProgress: boolean
    }
  | {
      lifecycle: 'released'
      accuracy: null
      amountMicros: null
      minimumMicros: null
      maximumMicros: null
      estimateInProgress: false
    }

export type CostAccuracyInput =
  | { lifecycle: 'reserved'; reservedMicros: number }
  | { lifecycle: 'released' }
  | {
      lifecycle: 'settled'
      outcome: 'success'
      providerAmountMicros?: number
      observedTokens?: number
      microsPerToken?: number
    }
  | {
      lifecycle: 'settled'
      outcome: 'unknown'
      reservedMicros: number
      observedTokens?: number
      microsPerToken?: number
    }

function checkedIntegerMicros(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COST_MICROS) {
    throw new RangeError(`${name} must be an integer between 0 and ${MAX_COST_MICROS} micros`)
  }
  return value
}

function checkedNonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite non-negative number`)
  return value
}

export function tokenCostMicros(observedTokens: number, microsPerToken: number): number {
  if (!Number.isSafeInteger(observedTokens) || observedTokens < 0) {
    throw new RangeError('Observed tokens must be a non-negative safe integer')
  }
  checkedNonNegativeNumber(microsPerToken, 'Token rate')
  const amount = Math.ceil(observedTokens * microsPerToken)
  return checkedIntegerMicros(amount, 'Token-derived cost')
}

export function addCostMicros(left: number, right: number): number {
  checkedIntegerMicros(left, 'Left cost')
  checkedIntegerMicros(right, 'Right cost')
  return checkedIntegerMicros(left + right, 'Aggregated cost')
}

function tokenEvidence(input: { observedTokens?: number; microsPerToken?: number }): number | null {
  if (input.observedTokens === undefined && input.microsPerToken === undefined) return null
  if (input.observedTokens === undefined || input.microsPerToken === undefined) {
    throw new Error('Observed tokens and token rate must be provided together')
  }
  return tokenCostMicros(input.observedTokens, input.microsPerToken)
}

export function derivePublicCost(input: CostAccuracyInput): PublicCostAmount {
  if (input.lifecycle === 'released') {
    return {
      lifecycle: 'released',
      accuracy: null,
      amountMicros: null,
      minimumMicros: null,
      maximumMicros: null,
      estimateInProgress: false,
    }
  }

  if (input.lifecycle === 'reserved') {
    const reservedMicros = checkedIntegerMicros(input.reservedMicros, 'Reserved cost')
    return {
      lifecycle: 'reserved',
      accuracy: 'estimated',
      amountMicros: reservedMicros,
      minimumMicros: 0,
      maximumMicros: reservedMicros,
      estimateInProgress: true,
    }
  }

  const observedMicros = tokenEvidence(input)
  if (input.outcome === 'success') {
    if (input.providerAmountMicros !== undefined) {
      const actualMicros = checkedIntegerMicros(input.providerAmountMicros, 'Provider cost')
      return {
        lifecycle: 'settled',
        accuracy: 'actual',
        amountMicros: actualMicros,
        minimumMicros: actualMicros,
        maximumMicros: actualMicros,
        estimateInProgress: false,
      }
    }
    if (observedMicros === null) throw new Error('Successful billing requires provider cost or token evidence')
    return {
      lifecycle: 'settled',
      accuracy: 'estimated',
      amountMicros: observedMicros,
      minimumMicros: observedMicros,
      maximumMicros: observedMicros,
      estimateInProgress: false,
    }
  }

  const reservedMicros = checkedIntegerMicros(input.reservedMicros, 'Reserved cost')
  const minimumMicros = 0
  const maximumMicros = Math.max(reservedMicros, observedMicros ?? 0)
  return {
    lifecycle: 'settled',
    accuracy: 'billing_indeterminate',
    amountMicros: maximumMicros,
    minimumMicros,
    maximumMicros,
    estimateInProgress: false,
  }
}

export function aggregatePublicCosts(costs: readonly PublicCostAmount[]): PublicCostAmount {
  const charged = costs.filter(
    (cost): cost is Extract<PublicCostAmount, { lifecycle: 'reserved' | 'settled' }> => cost.lifecycle !== 'released',
  )
  if (charged.length === 0) return derivePublicCost({ lifecycle: 'released' })

  const sum = (select: (cost: (typeof charged)[number]) => number) =>
    charged.reduce((total, cost) => addCostMicros(total, select(cost)), 0)
  const lifecycle: CostLifecycle = charged.some(cost => cost.lifecycle === 'reserved') ? 'reserved' : 'settled'
  const accuracy: CostAccuracy = charged.some(cost => cost.accuracy === 'billing_indeterminate')
    ? 'billing_indeterminate'
    : charged.some(cost => cost.accuracy === 'estimated')
      ? 'estimated'
      : 'actual'

  return {
    lifecycle,
    accuracy,
    amountMicros: sum(cost => cost.amountMicros),
    minimumMicros: sum(cost => cost.minimumMicros),
    maximumMicros: sum(cost => cost.maximumMicros),
    estimateInProgress: charged.some(cost => cost.estimateInProgress),
  }
}
