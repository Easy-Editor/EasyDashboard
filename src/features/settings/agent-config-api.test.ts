import { describe, expect, it } from 'vitest'
import { microsToUsdInput, usdInputToMicros } from './agent-config-api'

describe('Agent model budget inputs', () => {
  it('converts user-visible USD values to integer micros without floating point residue', () => {
    expect(usdInputToMicros('1.25')).toBe(1_250_000)
    expect(microsToUsdInput(1_250_000)).toBe('1.25')
  })

  it('rejects empty, non-numeric, zero, and negative budgets', () => {
    expect(usdInputToMicros('')).toBeNull()
    expect(usdInputToMicros('not-a-number')).toBeNull()
    expect(usdInputToMicros('0')).toBeNull()
    expect(usdInputToMicros('-1')).toBeNull()
  })
})
