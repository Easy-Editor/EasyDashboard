import { describe, expect, it } from 'vitest'
import {
  MAX_COST_MICROS,
  addCostMicros,
  aggregatePublicCosts,
  derivePublicCost,
  tokenCostMicros,
} from './cost-accuracy.js'

describe('cost accuracy', () => {
  it('reports a successful token-priced call as an exact estimate', () => {
    expect(
      derivePublicCost({ lifecycle: 'settled', outcome: 'success', observedTokens: 1_234, microsPerToken: 2.5 }),
    ).toEqual({
      lifecycle: 'settled',
      accuracy: 'estimated',
      amountMicros: 3_085,
      minimumMicros: 3_085,
      maximumMicros: 3_085,
      estimateInProgress: false,
    })
  })

  it('prefers an authoritative provider bill and marks it actual', () => {
    expect(
      derivePublicCost({
        lifecycle: 'settled',
        outcome: 'success',
        providerAmountMicros: 2_900,
        observedTokens: 1_234,
        microsPerToken: 2.5,
      }),
    ).toMatchObject({ accuracy: 'actual', amountMicros: 2_900, minimumMicros: 2_900, maximumMicros: 2_900 })
  })

  it('reports an unknown network outcome with a conservative range', () => {
    expect(derivePublicCost({ lifecycle: 'settled', outcome: 'unknown', reservedMicros: 5_000 })).toMatchObject({
      accuracy: 'billing_indeterminate',
      amountMicros: 5_000,
      minimumMicros: 0,
      maximumMicros: 5_000,
    })
  })

  it('keeps a reservation visibly in progress', () => {
    expect(derivePublicCost({ lifecycle: 'reserved', reservedMicros: 4_000 })).toEqual({
      lifecycle: 'reserved',
      accuracy: 'estimated',
      amountMicros: 4_000,
      minimumMicros: 0,
      maximumMicros: 4_000,
      estimateInProgress: true,
    })
  })

  it('does not expose released reservations as a charge', () => {
    expect(derivePublicCost({ lifecycle: 'released' })).toEqual({
      lifecycle: 'released',
      accuracy: null,
      amountMicros: null,
      minimumMicros: null,
      maximumMicros: null,
      estimateInProgress: false,
    })
  })

  it('never caps observed token cost at a lower reservation', () => {
    expect(
      derivePublicCost({
        lifecycle: 'settled',
        outcome: 'unknown',
        reservedMicros: 1_000,
        observedTokens: 2_000,
        microsPerToken: 3,
      }),
    ).toMatchObject({ amountMicros: 6_000, minimumMicros: 0, maximumMicros: 6_000 })
  })

  it('aggregates ranges and preserves the least certain accuracy and active lifecycle', () => {
    const actual = derivePublicCost({ lifecycle: 'settled', outcome: 'success', providerAmountMicros: 900 })
    const uncertain = derivePublicCost({ lifecycle: 'settled', outcome: 'unknown', reservedMicros: 2_000 })
    const reserved = derivePublicCost({ lifecycle: 'reserved', reservedMicros: 3_000 })

    expect(aggregatePublicCosts([actual, uncertain, reserved, derivePublicCost({ lifecycle: 'released' })])).toEqual({
      lifecycle: 'reserved',
      accuracy: 'billing_indeterminate',
      amountMicros: 5_900,
      minimumMicros: 900,
      maximumMicros: 5_900,
      estimateInProgress: true,
    })
  })

  it('rejects micros arithmetic that exceeds durable integer bounds', () => {
    expect(() => tokenCostMicros(MAX_COST_MICROS, 2)).toThrow(RangeError)
    expect(() => addCostMicros(MAX_COST_MICROS, 1)).toThrow(RangeError)
  })
})
