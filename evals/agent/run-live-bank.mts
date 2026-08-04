import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requestAgentChangeSet } from '../../server/src/agent/change-set-model.js'
import { evaluateBankFinancialSceneDecision } from '../../server/src/agent/dashboard-scene-quality.js'
import type { ResolvedAgentModelRuntime } from '../../server/src/routes/agent-config.js'
import type { ProjectRecord } from '../../server/src/types.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const casePath = resolve(root, 'evals/agent/cases/bank-financial-report-v1.json')
const benchmark = JSON.parse(await readFile(casePath, 'utf8')) as {
  id: string
  title: string
  prompt: string
  canvas: { width: number; height: number }
}

const endpoint = process.env.EASY_EDITOR_AGENT_BASE_URL
const apiKey = process.env.EASY_EDITOR_AGENT_API_KEY
const model = process.env.EASY_EDITOR_AGENT_MODEL
if (!endpoint || !apiKey || !model) {
  throw new Error(
    'Live bank evaluation requires EASY_EDITOR_AGENT_BASE_URL, EASY_EDITOR_AGENT_API_KEY, and EASY_EDITOR_AGENT_MODEL',
  )
}

const dohEndpoint = new URL(process.env.EASY_EDITOR_AGENT_DOH_URL ?? 'https://cloudflare-dns.com/dns-query')
if (dohEndpoint.protocol !== 'https:' || dohEndpoint.username || dohEndpoint.password) {
  throw new Error('EASY_EDITOR_AGENT_DOH_URL must be a credential-free HTTPS URL')
}

const resolvePublicHost = async (hostname: string) => {
  const query = new URL(dohEndpoint)
  query.searchParams.set('name', hostname)
  query.searchParams.set('type', 'A')
  const response = await fetch(query, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Public DNS lookup failed (${response.status})`)
  const payload = (await response.json()) as { Answer?: Array<{ data?: unknown; type?: unknown }> }
  const addresses = (payload.Answer ?? [])
    .filter(answer => answer.type === 1 && typeof answer.data === 'string' && isIP(answer.data) === 4)
    .map(answer => answer.data as string)
  if (!addresses.length) throw new Error('Public DNS lookup returned no IPv4 address')
  return addresses
}

const runtime: ResolvedAgentModelRuntime = {
  profileId: 'eval:bank-financial-report-v1',
  provider: 'platform',
  endpoint: new URL(endpoint),
  apiKey,
  model,
  budget: { taskMicros: 5_000_000, projectMonthMicros: 50_000_000, warningRatio: 0.8 },
  capabilities: { vision: false, toolCalling: true, structuredOutput: true },
  billingScope: 'project',
  payerId: '00000000-0000-4000-8000-000000000001',
  source: 'platform-default',
}

const project = {
  id: '00000000-0000-4000-8000-000000000002',
  name: benchmark.title,
  description: 'Text-only live generation quality benchmark',
  draftVersion: 1,
  canvasWidth: benchmark.canvas.width,
  canvasHeight: benchmark.canvas.height,
  pageCount: 1,
  draftSchema: {
    version: '1.0.0',
    componentsMap: [],
    meta: { easyDashboard: { documentVersion: 1, startPageId: 'page-home' } },
    componentsTree: [
      {
        id: 'page-home-root',
        docId: 'page-home',
        fileName: 'home',
        fileDesc: '首页',
        componentName: 'Root',
        props: { backgroundColor: '#eef3f7' },
        isRoot: true,
        meta: { easyDashboard: { pageId: 'page-home' } },
        $dashboard: { rect: { x: 0, y: 0, width: benchmark.canvas.width, height: benchmark.canvas.height } },
        children: [],
      },
    ],
  },
} as unknown as ProjectRecord

const startedAt = new Date()
const result = await requestAgentChangeSet({
  runtime,
  prompt: benchmark.prompt,
  conversationTurns: [],
  project,
  conversationId: randomUUID(),
  taskId: randomUUID(),
  attachments: [],
  projectContext: [],
  resolveHost: resolvePublicHost,
  timeoutMs: 120_000,
})
const quality = evaluateBankFinancialSceneDecision(result.output)
const completedAt = new Date()
const outputDirectory = resolve(root, 'output/evals/bank-financial-report-v1')
await mkdir(outputDirectory, { recursive: true })
const artifactPath = resolve(outputDirectory, `${completedAt.toISOString().replaceAll(':', '-')}.json`)
await writeFile(
  artifactPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      caseId: benchmark.id,
      inputMode: 'text-only',
      model,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      prompt: benchmark.prompt,
      trace: result.trace,
      usage: result.usage,
      providerAttempt: result.providerAttempt,
      output: result.output,
      quality,
    },
    null,
    2,
  )}\n`,
  'utf8',
)

process.stdout.write(
  `${JSON.stringify({ caseId: benchmark.id, model, passed: quality.passed, score: quality.score, artifactPath })}\n`,
)
if (!quality.passed) process.exitCode = 1
