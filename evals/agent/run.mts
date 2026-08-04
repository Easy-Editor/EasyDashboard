import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type DashboardEvaluationCase,
  type RecordedAgentResult,
  compareRecordedEvaluations,
} from '../../server/src/agent/evaluation.js'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))

async function readJson<T>(path: string | URL): Promise<T> {
  const source = typeof path === 'string' ? (isAbsolute(path) ? path : resolve(projectRoot, path)) : path
  return JSON.parse(await readFile(source, 'utf8')) as T
}

async function main(): Promise<void> {
  const [candidatePath, baselinePath, datasetPath] = process.argv.slice(2)
  if (!candidatePath) {
    throw new Error('Usage: tsx evals/agent/run.mts <candidate.json> [baseline.json] [dataset.json]')
  }

  const cases = await readJson<DashboardEvaluationCase[]>(
    datasetPath ?? new URL('./dashboard-cases.json', import.meta.url),
  )
  const candidate = await readJson<RecordedAgentResult[]>(candidatePath)
  const baseline = baselinePath ? await readJson<RecordedAgentResult[]>(baselinePath) : undefined
  const comparison = compareRecordedEvaluations(cases, candidate, baseline)
  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`)
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
