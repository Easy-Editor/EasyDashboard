import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { type Server, createServer } from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createPgRepository } from '../db/repository.js'
import type { AppEnv } from '../env.js'
import { type AgentSpikeIssueRequest, issueAgentSpikeOperation } from '../routes/agent-spike.js'
import type { AuthService } from '../types.js'
import type { ProjectSchema } from '../validation.js'

const runtimeDatabaseUrl = process.env.AGENT_SPIKE_TEST_DATABASE_URL
const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const easyEditorDirectory = process.env.AGENT_SPIKE_TEST_EASY_EDITOR_DIR
const documentExecutorConfigured = Boolean(runtimeDatabaseUrl && adminDatabaseUrl && easyEditorDirectory)
const describeWithDocumentExecutor = documentExecutorConfigured ? describe : describe.skip

const admin = documentExecutorConfigured && adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null
const grantSecret = 'm0-cross-repository-grant-secret-is-at-least-thirty-two-bytes'

interface MinimalPrepareInput {
  executorId: string
  operationId: string
  taskId: string
  stageId: string
  compatibility: AppEnv['AGENT_EXECUTOR_COMPATIBILITY_JSON']
  invocation: AgentSpikeIssueRequest['invocation']
}

interface EasyEditorFixtureModule {
  createMinimalPrepareInput(suffix: string): Promise<MinimalPrepareInput>
  createMinimalStoredProject(suffix: string): ProjectSchema
}

interface PreparedExecution {
  candidateProject: {
    schema: ProjectSchema
    sha256: string
  }
  semanticReceipt: {
    status: string
  }
  evidence: {
    console: Array<{ message: string }>
  }
}

interface DocumentWorkflowResult {
  prepared: PreparedExecution | null
  outcome: {
    status: string
    committedDraftVersion: number
    candidateSha256: string
    commitReceipt: {
      receiptVersion: string
      committedDraftVersion: number
      candidateSha256: string
      repositoryWitness: {
        kind: string
      }
    }
  }
  recovery: {
    classification: 'issued' | 'prepared' | 'committed' | 'executed'
    browserExecuted: boolean
  }
}

interface DocumentWorkflowInput {
  operationId: string
  grantToken: string
  recoveryGrantToken: string
  honoOrigin: string
  endpoints: {
    input: string
    prepared: string
    commit: string
    outcome: string
  }
}

function repositoryEnv(
  databaseUrl: string,
  appOrigin: string,
  compatibility: NonNullable<MinimalPrepareInput['compatibility']>,
): AppEnv {
  return {
    NODE_ENV: 'test',
    APP_ORIGIN: appOrigin,
    PUBLIC_VIEWER_ORIGIN: appOrigin,
    PORT: Number(new URL(appOrigin).port),
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1234567890',
    DATABASE_URL: databaseUrl,
    AGENT_EXECUTOR_GRANT_SECRET: grantSecret,
    AGENT_EXECUTOR_COMPATIBILITY_JSON: compatibility,
  }
}

function fakeAuth(actorId: string): AuthService {
  const unsupported = async (): Promise<never> => {
    throw new Error('Authentication flow is outside the document executor integration seam')
  }
  return {
    signUp: unsupported,
    signIn: unsupported,
    startOAuth: unsupported,
    exchangeCode: unsupported,
    requestPasswordReset: unsupported,
    updatePassword: unsupported,
    refresh: unsupported,
    getUser: async accessToken =>
      accessToken === 'm0-e2e-access' ? { id: actorId, email: 'm0-document-executor@example.com' } : null,
    signOut: async () => undefined,
  }
}

async function reservePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Failed to reserve a loopback port')
  }
  const { port } = address
  server.close()
  await once(server, 'close')
  return port
}

async function waitForUrl(url: string, processHandle?: ChildProcessWithoutNullStreams): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (processHandle?.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready with code ${processHandle?.exitCode}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error(`Readiness request returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`)
}

function documentExecutorBuildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    VITE_DASHBOARD_AGENT_RUNTIME: '1',
    VITE_DASHBOARD_AGENT_DATA: '0',
    VITE_DASHBOARD_AGENT_ONLINE: '0',
    VITE_DASHBOARD_AGENT_PROMOTION: '0',
    VITE_E2E: '1',
  }
}

async function buildViteHarness(easyEditorDir: string): Promise<void> {
  const spikeDirectory = resolve(easyEditorDir, 'spikes/document-executor')
  const processHandle = spawn('pnpm', ['--dir', spikeDirectory, 'build'], {
    cwd: easyEditorDir,
    env: documentExecutorBuildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  processHandle.stdout.on('data', chunk => {
    stdout = `${stdout}${chunk.toString()}`.slice(-16_384)
  })
  processHandle.stderr.on('data', chunk => {
    stderr = `${stderr}${chunk.toString()}`.slice(-16_384)
  })
  const [exitCode] = (await once(processHandle, 'close')) as [number | null]
  if (exitCode !== 0) {
    throw new Error(`EasyEditor static Harness build failed with ${String(exitCode)}: ${stderr || stdout}`)
  }
}

async function startViteHarness(easyEditorDir: string, port: number): Promise<ChildProcessWithoutNullStreams> {
  const dashboardDirectory = resolve(easyEditorDir, 'examples/dashboard')
  const vite = resolve(dashboardDirectory, 'node_modules/.bin/vite')
  const config = resolve(easyEditorDir, 'spikes/document-executor/vite.config.mts')
  const processHandle = spawn(
    vite,
    ['preview', '--config', config, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: dashboardDirectory,
      env: documentExecutorBuildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  processHandle.stdin.end()
  let stderr = ''
  processHandle.stderr.on('data', chunk => {
    stderr = `${stderr}${chunk.toString()}`.slice(-16_384)
  })
  try {
    await waitForUrl(`http://127.0.0.1:${port}/index.html`, processHandle)
    return processHandle
  } catch (error) {
    processHandle.kill('SIGTERM')
    throw new AggregateError([error, new Error(stderr)], 'EasyEditor Vite harness failed to start')
  }
}

async function stopProcess(processHandle: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!processHandle || processHandle.exitCode !== null) return
  processHandle.kill('SIGTERM')
  await Promise.race([once(processHandle, 'exit'), new Promise(resolveDelay => setTimeout(resolveDelay, 5_000))])
  if (processHandle.exitCode === null) processHandle.kill('SIGKILL')
}

async function stopServer(server: Server | null): Promise<void> {
  if (!server?.listening) return
  server.close()
  await once(server, 'close')
}

async function runDocumentExecutorWorkflow(
  easyEditorDir: string,
  dashboardUrl: string,
  input: DocumentWorkflowInput,
): Promise<DocumentWorkflowResult> {
  const cliPath = resolve(easyEditorDir, 'spikes/document-executor/src/cli.mjs')
  const executor = spawn(process.execPath, [cliPath], {
    cwd: easyEditorDir,
    env: {
      ...process.env,
      EASY_EDITOR_DOCUMENT_EXECUTOR_DASHBOARD_URL: dashboardUrl,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  executor.stdout.on('data', chunk => {
    stdout = `${stdout}${chunk.toString()}`.slice(-1_000_000)
  })
  executor.stderr.on('data', chunk => {
    stderr = `${stderr}${chunk.toString()}`.slice(-16_384)
  })
  executor.stdin.end(JSON.stringify(input))
  const [exitCode] = (await once(executor, 'close')) as [number | null]
  if (exitCode !== 0) {
    throw new Error(`Document Executor CLI exited with ${String(exitCode)}: ${stderr || stdout}`)
  }
  return JSON.parse(stdout) as DocumentWorkflowResult
}

async function seedActorAndProject(actorId: string, projectId: string, schema: ProjectSchema): Promise<void> {
  if (!admin) throw new Error('M0 cross-repository test requires an administrator database')
  const spaceId = randomUUID()
  await admin.query('insert into auth.users (id) values ($1)', [actorId])
  await admin.query(
    `insert into app.spaces (id, kind, name, personal_owner_id, created_by)
     values ($1, 'personal', 'M0 cross-repository executor', $2, $2)`,
    [spaceId, actorId],
  )
  await admin.query(
    `insert into app.space_members (space_id, user_id, role)
     values ($1, $2, 'owner')`,
    [spaceId, actorId],
  )
  await admin.query(
    `insert into app.projects (id, owner_id, space_id, name, draft_schema)
     values ($1, $2, $3, 'M0 cross-repository executor', $4::jsonb)`,
    [projectId, actorId, spaceId, JSON.stringify(schema)],
  )
  await admin.query(
    `insert into app.project_members (project_id, user_id, role, created_by)
     values ($1, $2, 'owner', $2)`,
    [projectId, actorId],
  )
}

async function cleanupActor(actorId: string): Promise<void> {
  if (!admin) return
  await admin.query('delete from app.projects where owner_id = $1', [actorId])
  await admin.query('delete from app.spaces where created_by = $1', [actorId])
  await admin.query('delete from auth.users where id = $1', [actorId])
}

async function bearerRequest(url: string, grant: string, method = 'GET', body?: unknown): Promise<Response> {
  const origin = new URL(url).origin
  return fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${grant}`,
      ...(method === 'GET'
        ? {}
        : {
            'content-type': 'application/json',
            origin,
            'x-csrf-token': '1',
          }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describeWithDocumentExecutor('EasyEditor document executor cross-repository integration', () => {
  afterAll(async () => {
    await admin?.end()
  })

  it(
    'commits one durable editable text change through authenticated Hono and idempotent executor retries',
    { timeout: 180_000 },
    async () => {
      const suffix = randomUUID()
      const actorId = randomUUID()
      const projectId = randomUUID()
      await buildViteHarness(easyEditorDirectory!)
      const fixtureUrl = pathToFileURL(
        resolve(easyEditorDirectory!, 'spikes/document-executor/fixtures/minimal-draft.mjs'),
      ).href
      const fixture = (await import(fixtureUrl)) as EasyEditorFixtureModule
      const configuredInput = await fixture.createMinimalPrepareInput(suffix)
      const compatibility = configuredInput.compatibility
      if (!compatibility) throw new Error('EasyEditor fixture did not provide a compatibility tuple')
      const baseSchema = fixture.createMinimalStoredProject(suffix)
      const honoPort = await reservePort()
      const vitePort = await reservePort()
      const honoOrigin = `http://127.0.0.1:${honoPort}`
      const env = repositoryEnv(runtimeDatabaseUrl!, honoOrigin, compatibility)
      const repository = createPgRepository(env)
      const app = createApp({
        env,
        auth: fakeAuth(actorId),
        repository,
      })
      let honoServer: Server | null = null
      let viteProcess: ChildProcessWithoutNullStreams | null = null
      let executorApiFailure: unknown = null

      try {
        await seedActorAndProject(actorId, projectId, baseSchema)
        honoServer = serve({
          fetch: async request => {
            const response = await app.fetch(request)
            if (!response.ok && new URL(request.url).pathname.startsWith('/api/agent-spike/')) {
              executorApiFailure = await response.clone().json()
            }
            return response
          },
          hostname: '127.0.0.1',
          port: honoPort,
        })
        await once(honoServer, 'listening')
        viteProcess = await startViteHarness(easyEditorDirectory!, vitePort)

        const issued = await issueAgentSpikeOperation(
          {
            repository,
            grantSecret,
            expectedCompatibility: compatibility,
          },
          actorId,
          projectId,
          {
            executorId: configuredInput.executorId,
            operationId: configuredInput.operationId,
            taskId: configuredInput.taskId,
            stageId: configuredInput.stageId,
            compatibility,
            invocation: configuredInput.invocation,
          },
        )
        expect(issued.input.compatibility).toEqual(compatibility)
        expect(issued.input.baseDraftVersion).toBe(1)

        const operationBase = `${honoOrigin}/api/agent-spike/operations/${configuredInput.operationId}`
        const endpoints = {
          input: `${operationBase}/input`,
          prepared: `${operationBase}/prepared`,
          commit: `${operationBase}/commit`,
          outcome: `${operationBase}/outcome`,
        }
        const workflow = await runDocumentExecutorWorkflow(
          easyEditorDirectory!,
          `http://127.0.0.1:${vitePort}/editor`,
          {
            operationId: configuredInput.operationId,
            grantToken: issued.grant,
            recoveryGrantToken: issued.recoveryGrant,
            honoOrigin,
            endpoints,
          },
        ).catch(error => {
          throw new AggregateError(
            [error, new Error(`Last executor API failure: ${JSON.stringify(executorApiFailure)}`)],
            'Document Executor workflow failed',
          )
        })
        expect(workflow.prepared).not.toBeNull()
        if (!workflow.prepared) throw new Error('Issued workflow did not execute the document')
        expect(workflow.recovery).toEqual({
          classification: 'executed',
          browserExecuted: true,
        })
        expect(workflow.prepared.semanticReceipt.status).toBe('applied')
        expect(
          (
            (
              (workflow.prepared.candidateProject.schema.editorSchema as Record<string, unknown>)
                .componentsTree as Array<Record<string, unknown>>
            )[0]?.children as Array<Record<string, unknown>>
          )[0]?.props,
        ).toMatchObject({ text: `After executor ${suffix}` })
        expect(
          workflow.prepared.evidence.console.some(entry => entry.message.includes('reloadEditUndo=verified')),
        ).toBe(true)
        expect(workflow.outcome).toMatchObject({
          status: 'committed',
          committedDraftVersion: 2,
          candidateSha256: workflow.prepared.candidateProject.sha256,
          commitReceipt: {
            receiptVersion: 'easy-dashboard.cas-commit-receipt.v1',
            committedDraftVersion: 2,
            candidateSha256: workflow.prepared.candidateProject.sha256,
            repositoryWitness: {
              kind: 'hono.repository.cas',
            },
          },
        })

        const commitBody = {
          candidateSha256: workflow.prepared.candidateProject.sha256,
        }
        const firstCommit = await bearerRequest(endpoints.commit, issued.grant, 'POST', commitBody)
        const firstCommitBytes = await firstCommit.text()
        const repeatedCommit = await bearerRequest(endpoints.commit, issued.grant, 'POST', commitBody)
        const repeatedCommitBytes = await repeatedCommit.text()
        expect(firstCommit.status).toBe(200)
        expect(repeatedCommit.status).toBe(200)
        expect(repeatedCommitBytes).toBe(firstCommitBytes)

        const firstOutcome = await bearerRequest(endpoints.outcome, issued.recoveryGrant)
        const firstOutcomeBytes = await firstOutcome.text()
        const repeatedOutcome = await bearerRequest(endpoints.outcome, issued.recoveryGrant)
        const repeatedOutcomeBytes = await repeatedOutcome.text()
        expect(firstOutcome.status).toBe(200)
        expect(repeatedOutcome.status).toBe(200)
        expect(repeatedOutcomeBytes).toBe(firstOutcomeBytes)

        const persisted = await admin!.query<{
          draft_version: number
          title: string
          operation_count: string
          revision_count: string
        }>(
          `select
             project.draft_version,
             project.draft_schema #>> '{editorSchema,componentsTree,0,children,0,props,text}' as title,
             (
               select count(*)::text
               from app.agent_spike_operations operation
               where operation.project_id = project.id
                 and operation.operation_id = $2
             ) as operation_count,
             (
               select count(*)::text
               from app.project_revisions revision
               where revision.project_id = project.id
                 and revision.source_draft_version = project.draft_version
             ) as revision_count
           from app.projects project
           where project.id = $1`,
          [projectId, configuredInput.operationId],
        )
        expect(persisted.rows[0]).toEqual({
          draft_version: 2,
          title: `After executor ${suffix}`,
          operation_count: '1',
          revision_count: '1',
        })
      } finally {
        await stopProcess(viteProcess)
        await stopServer(honoServer)
        await cleanupActor(actorId)
      }
    },
  )
})
