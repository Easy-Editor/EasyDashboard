import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { basename, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requestAgentChangeSet } from '../../server/src/agent/change-set-model.js'
import type { ResolvedAgentModelRuntime } from '../../server/src/routes/agent-config.js'
import type { AgentAssetRecord, ProjectRecord } from '../../server/src/types.js'
import {
  type GlobalNaturalResourcesBenchmark,
  evaluateGlobalNaturalResourcesDecision,
} from './global-natural-resources-quality.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const casePath = resolve(root, 'evals/agent/cases/global-natural-resources-v1.json')
const benchmark = JSON.parse(await readFile(casePath, 'utf8')) as GlobalNaturalResourcesBenchmark

const referencePaths = process.argv.slice(2).map(path => resolve(path))
if (referencePaths.length < 2 || referencePaths.length > 4) {
  throw new Error(
    'Usage: tsx evals/agent/run-live-global-natural-resources.mts <layout.png> <gif-frame-1.png> [gif-frame-2.png] [gif-frame-3.png]',
  )
}

const endpoint = process.env.EASY_EDITOR_AGENT_BASE_URL
const apiKey = process.env.EASY_EDITOR_AGENT_API_KEY
const model = process.env.EASY_EDITOR_AGENT_MODEL
if (!endpoint || !apiKey || !model) {
  throw new Error(
    'Live natural-resources evaluation requires EASY_EDITOR_AGENT_BASE_URL, EASY_EDITOR_AGENT_API_KEY, and EASY_EDITOR_AGENT_MODEL',
  )
}

const contentTypeByExtension: Record<string, 'image/png' | 'image/jpeg' | 'image/webp'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}
const now = new Date()
const referenceImages = await Promise.all(
  referencePaths.map(async (path, index) => {
    const contentType = contentTypeByExtension[extname(path).toLocaleLowerCase('en-US')]
    if (!contentType) {
      throw new Error(`Reference ${basename(path)} must be PNG, JPEG, or WebP; extract GIF frames before running`)
    }
    const bytes = await readFile(path)
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error(`Reference ${basename(path)} exceeds 10 MiB`)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const assetId = randomUUID()
    const asset: AgentAssetRecord = {
      id: assetId,
      projectId: '00000000-0000-4000-8000-000000000012',
      conversationId: '00000000-0000-4000-8000-000000000013',
      originalName: basename(path),
      contentType,
      size: bytes.byteLength,
      sha256,
      status: 'ready',
      extractedText: null,
      storagePath: `eval-reference-${index + 1}`,
      createdAt: now,
      updatedAt: now,
    }
    return {
      asset,
      modelImage: { assetId, url: `data:${contentType};base64,${bytes.toString('base64')}` },
      artifact: { name: asset.originalName, contentType, size: asset.size, sha256 },
    }
  }),
)

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
  profileId: 'eval:global-natural-resources-v1',
  provider: 'platform',
  endpoint: new URL(endpoint),
  apiKey,
  model,
  budget: { taskMicros: 8_000_000, projectMonthMicros: 50_000_000, warningRatio: 0.8 },
  capabilities: { vision: true, toolCalling: true, structuredOutput: true },
  billingScope: 'project',
  payerId: '00000000-0000-4000-8000-000000000011',
  source: 'platform-default',
}

const project = {
  id: '00000000-0000-4000-8000-000000000012',
  name: benchmark.title,
  description: 'Natural-language plus reference-frame live generation quality benchmark',
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
        props: { backgroundColor: '#020814' },
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
  conversationId: '00000000-0000-4000-8000-000000000013',
  taskId: randomUUID(),
  attachments: referenceImages.map(reference => reference.asset),
  images: referenceImages.map(reference => reference.modelImage),
  projectContext: [],
  resolveHost: resolvePublicHost,
  timeoutMs: 240_000,
})
const quality = evaluateGlobalNaturalResourcesDecision(result.output, benchmark)
const completedAt = new Date()
const outputDirectory = resolve(root, 'output/evals/global-natural-resources-v1')
await mkdir(outputDirectory, { recursive: true })
const artifactPath = resolve(outputDirectory, `${completedAt.toISOString().replaceAll(':', '-')}.json`)
await writeFile(
  artifactPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      caseId: benchmark.id,
      inputMode: benchmark.inputMode,
      model,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      prompt: benchmark.prompt,
      referenceImages: referenceImages.map(reference => reference.artifact),
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
  `${JSON.stringify({
    caseId: benchmark.id,
    model,
    passed: quality.passed,
    score: quality.score,
    hardGateSummary: quality.hardGateSummary,
    failureTags: quality.failureTags,
    artifactPath,
  })}\n`,
)
if (!quality.passed) process.exitCode = 1
