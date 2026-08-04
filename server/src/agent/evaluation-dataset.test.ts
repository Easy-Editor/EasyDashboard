import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { DashboardEvaluationCase } from './evaluation.js'

async function readDataset(): Promise<DashboardEvaluationCase[]> {
  const url = new URL('../../../evals/agent/dashboard-cases.json', import.meta.url)
  return JSON.parse(await readFile(url, 'utf8')) as DashboardEvaluationCase[]
}

describe('fixed dashboard evaluation dataset', () => {
  it('contains at least 20 unique, deterministic contract cases', async () => {
    const cases = await readDataset()

    expect(cases.length).toBeGreaterThanOrEqual(20)
    expect(new Set(cases.map(testCase => testCase.id)).size).toBe(cases.length)
    for (const testCase of cases) {
      expect(testCase.prompt.trim()).not.toBe('')
      expect(testCase.expected.requiredCapabilities).toContain('screen.applyChangeSet')
      expect(testCase.expected.requiredKeywords.length).toBeGreaterThan(0)
      expect(testCase.expected.minOperationCount).toBeGreaterThan(0)
    }
  })
})
