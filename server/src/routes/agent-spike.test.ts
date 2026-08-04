import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  EXECUTOR_CONTRACT_VERSION,
  EXECUTOR_GRANT_SCOPES,
  type ExecutorPrepareInput,
  type ExecutorPreparedResult,
  MAX_EXECUTOR_RECOVERY_GRANT_LIFETIME_SECONDS,
  authorizeExecutorPrepare,
  createDocumentDescriptor,
  hashCompatibilityTuple,
  hashExecutorPrepareInput,
  mintExecutorGrant,
  verifyExecutorRecoveryGrant,
} from '../agent/executor-contract.js'
import { type AppDependencies, createApp as createProductionApp } from '../app.js'
import type { AppEnv } from '../env.js'
import type { AgentSpikeOperationRecord, AuthService, PublicUser, Repository } from '../types.js'
import {
  createAgentSpikeProjectRoutes,
  issueAgentSpikeOperation,
  restoreAgentSpikeOperationExecution,
} from './agent-spike.js'

const actor: PublicUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.com',
}
const projectId = '22222222-2222-4222-8222-222222222222'
const operationId = 'operation-1'
const grantSecret = 'm0-route-test-secret-that-is-at-least-thirty-two-bytes'
const now = new Date('2026-07-31T08:00:00.000Z')
const baseSchema = {
  version: '1.0.0',
  componentsTree: [
    {
      id: 'page-home-root',
      docId: 'page-home',
      fileName: 'page-home',
      componentName: 'Root',
      isRoot: true,
      meta: { easyDashboard: { pageId: 'page-home' } },
      $dashboard: { rect: { x: 0, y: 0, width: 1920, height: 1080 } },
      children: [],
    },
  ],
}
const candidateSchema = { componentsTree: [{ id: 'title', componentName: 'Text' }] }
const compatibility = {
  runtimeVersion: '0.1.0-m0',
  runtimeSha256: '1'.repeat(64),
  coreVersion: '1.0.3-m0',
  coreSha256: '2'.repeat(64),
  rendererVersion: '1.0.3-m0',
  rendererSha256: '3'.repeat(64),
  dashboardAgentHostVersion: '0.1.0-m0',
  dashboardAgentHostSha256: '4'.repeat(64),
  browserArtifactVersion: '0.0.0-m0',
  browserArtifactSha256: '6'.repeat(64),
  materialManifestVersion: 'manifest-2026-07-31',
  materialManifestSha256: '5'.repeat(64),
}
const invocation = {
  sessionId: 'session-1',
  stepId: 'step-1',
  callId: 'call-1',
  capability: 'screen.applyChangeSet' as const,
  arguments: {
    schemaVersion: 1 as const,
    documentId: 'page-home',
    operations: [
      {
        opId: 'insert-title',
        type: 'insert' as const,
        parentId: 'page-home-root',
        componentName: 'Text',
        fields: {
          'props.text': 'M0',
          'shared.rect': { x: 100, y: 120, width: 240, height: 60 },
        },
      },
    ],
  },
}

const env: AppEnv = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'https://app.example.com',
  PUBLIC_VIEWER_ORIGIN: 'https://view.example.com',
  PORT: 8787,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1234567890',
  DATABASE_URL: 'postgresql://test',
  AGENT_EXECUTOR_GRANT_SECRET: grantSecret,
  AGENT_EXECUTOR_COMPATIBILITY_JSON: compatibility,
}

function createApp(dependencies: AppDependencies) {
  const app = createProductionApp(dependencies)
  app.route(
    '/projects',
    createAgentSpikeProjectRoutes({
      repository: dependencies.repository,
      grantSecret: dependencies.env.AGENT_EXECUTOR_GRANT_SECRET,
      expectedCompatibility: dependencies.env.AGENT_EXECUTOR_COMPATIBILITY_JSON,
      ...dependencies.agentSpike,
    }),
  )
  return app
}

function auth(): AuthService {
  return {
    signUp: async () => ({ user: actor, session: null }),
    signIn: async () => {
      throw new Error('not used')
    },
    startOAuth: async () => {
      throw new Error('not used')
    },
    exchangeCode: async () => {
      throw new Error('not used')
    },
    requestPasswordReset: async () => {
      throw new Error('not used')
    },
    updatePassword: async () => {
      throw new Error('not used')
    },
    refresh: async () => {
      throw new Error('not refreshable')
    },
    getUser: async token => (token === 'access' ? actor : null),
    signOut: async () => undefined,
  }
}

function sha256(value: unknown): string {
  const canonical = (input: unknown): string => {
    if (input === null || typeof input !== 'object') return JSON.stringify(input)
    if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`
    const record = input as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`
  }
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

function preparedResult(input: ExecutorPrepareInput): ExecutorPreparedResult {
  const candidateProject = createDocumentDescriptor(candidateSchema)
  return {
    contractVersion: EXECUTOR_CONTRACT_VERSION,
    executorId: input.executorId,
    operationId: input.operationId,
    projectId: input.projectId,
    actorId: input.actorId,
    taskId: input.taskId,
    stageId: input.stageId,
    baseDraftVersion: input.baseDraftVersion,
    inputSha256: hashExecutorPrepareInput(input),
    compatibilitySha256: hashCompatibilityTuple(input.compatibility),
    compatibility: input.compatibility,
    candidateProject,
    semanticReceipt: {
      schemaVersion: 1,
      projectId,
      branchId: 'draft',
      callId: input.invocation.callId,
      status: 'applied',
      revision: 'revision-after',
      witness: { transactionId: 'transaction-1' },
    },
    evidence: {
      console: [],
      consoleErrors: [],
      requestFailures: [],
      render: {
        status: 'rendered',
        rendererReady: true,
        viewport: { width: 1920, height: 1080 },
        durationMs: 12,
        screenshotSha256: 'a'.repeat(64),
        resourceErrors: [],
      },
      materials: {
        manifestVersion: input.compatibility.materialManifestVersion,
        loaded: [{ materialId: 'text', version: '1.0.0' }],
        missing: [],
      },
      request: {
        requestId: 'request-1',
        startedAt: '2026-07-31T08:00:00.000Z',
        completedAt: '2026-07-31T08:00:00.100Z',
      },
      timing: {
        totalMs: 100,
        hostStartupMs: 20,
        applyChangeSetMs: 40,
        exportMs: 10,
      },
    },
    preRevision: 'revision-before',
    postRevision: 'revision-after',
    preparedAt: '2026-07-31T08:00:00.100Z',
  }
}

function createStatefulRepository() {
  let operation: AgentSpikeOperationRecord | null = null
  let commitCount = 0

  const repository = {
    ping: vi.fn(async () => undefined),
    getEditableProjectForAgentSpike: vi.fn(async () => ({
      id: projectId,
      draftVersion: 4,
      draftSchema: baseSchema,
    })),
    issueAgentSpikeOperation: vi.fn(async (actorId: string, input: Record<string, unknown>) => {
      if (operation) return operation
      operation = {
        id: 'ledger-1',
        actorId,
        projectId: input.projectId as string,
        taskId: input.taskId as string,
        stageId: input.stageId as string,
        executorId: input.executorId as string,
        operationId: input.operationId as string,
        grantJti: input.grantJti as string,
        baseDraftVersion: input.baseDraftVersion as number,
        inputDigest: input.inputDigest as string,
        executorInput: input.executorInput as Record<string, unknown>,
        issueDigest: 'b'.repeat(64),
        skillTrace: (input.skillTrace as AgentSpikeOperationRecord['skillTrace'] | undefined) ?? null,
        compatibility: input.compatibility as Record<string, string>,
        expiresAt: input.expiresAt as Date,
        status: 'issued',
        candidateDigest: null,
        preparedDigest: null,
        candidateSchema: null,
        hostReceipt: null,
        evidence: null,
        preparedAt: null,
        committedDraftVersion: null,
        rollbackRevisionId: null,
        rolledBackAt: null,
        rollbackReceipt: null,
        outcome: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      return operation
    }),
    getAgentSpikeOperationOutcome: vi.fn(async (_actorId: string, requestedOperationId: string) =>
      operation?.operationId === requestedOperationId ? operation : null,
    ),
    prepareAgentSpikeOperation: vi.fn(
      async (
        _actorId: string,
        _binding: Record<string, string>,
        _authority: Record<string, unknown>,
        input: {
          candidateSchema: Record<string, unknown>
          hostReceipt: Record<string, unknown>
          evidence: Record<string, unknown>
        },
      ) => {
        if (!operation) return null
        operation = {
          ...operation,
          status: 'prepared',
          candidateDigest: sha256(input.candidateSchema),
          preparedDigest: sha256(input),
          candidateSchema: input.candidateSchema,
          hostReceipt: input.hostReceipt,
          evidence: input.evidence,
          preparedAt: now,
          updatedAt: now,
        }
        return operation
      },
    ),
    commitAgentSpikeStage: vi.fn(async () => {
      if (!operation) return null
      if (operation.status !== 'committed') {
        commitCount += 1
        operation = {
          ...operation,
          status: 'committed',
          committedDraftVersion: 5,
          outcome: {
            status: 'committed',
            committedDraftVersion: 5,
            candidateDigest: operation.candidateDigest,
          },
          completedAt: now,
          updatedAt: now,
        }
      }
      return operation
    }),
  }

  return {
    repository: repository as unknown as Repository,
    getOperation: () => operation,
    getCommitCount: () => commitCount,
  }
}

function issueRequest(overrides: Record<string, unknown> = {}) {
  return new Request(`https://app.example.com/api/projects/${projectId}/agent-spike/operations`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer must-not-be-used-for-cookie-route',
      'content-type': 'application/json',
      cookie: '__Host-ed-access-token=access',
      origin: env.APP_ORIGIN,
      'sec-fetch-site': 'same-origin',
      'x-csrf-token': '1',
    },
    body: JSON.stringify({
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
      ...overrides,
    }),
  })
}

function executorMutation(path: string, token: string, method: 'PUT' | 'POST', body: unknown) {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin: env.APP_ORIGIN,
      'x-csrf-token': '1',
    },
    body: JSON.stringify(body),
  })
}

describe('M0 Agent spike Hono integration', () => {
  it('canonicalizes a legacy EasyEditor draft before issuing it to the document executor', async () => {
    const state = createStatefulRepository()
    const issued = await issueAgentSpikeOperation(
      {
        repository: state.repository,
        grantSecret,
        expectedCompatibility: compatibility,
        now: () => now,
        createGrantId: () => 'grant-jti-1',
      },
      actor.id,
      projectId,
      {
        executorId: 'executor-1',
        operationId,
        taskId: 'task-1',
        stageId: 'stage-1',
        compatibility,
        invocation,
      },
    )

    expect(issued.input.baseProject.schema).toEqual({
      formatVersion: 1,
      editorSchema: baseSchema,
      presentation: {
        startPageId: 'page-home',
        theme: expect.objectContaining({ mode: 'dark' }),
      },
    })
  })

  it('restores deterministic executor authority from the persisted operation after restart', async () => {
    const state = createStatefulRepository()
    const issueOptions = {
      repository: state.repository,
      grantSecret,
      expectedCompatibility: compatibility,
      now: () => now,
      createGrantId: () => 'grant-jti-1',
    }
    const issued = await issueAgentSpikeOperation(issueOptions, actor.id, projectId, {
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
    })

    const restored = await restoreAgentSpikeOperationExecution(
      {
        repository: state.repository,
        grantSecret,
        expectedCompatibility: compatibility,
        now: () => new Date(now.getTime() + 1_000),
      },
      actor.id,
      operationId,
    )

    expect(restored).toEqual(issued)
    expect(state.repository.issueAgentSpikeOperation).toHaveBeenCalledOnce()
  })

  it('restores a prepared operation so its persisted candidate can finish committing', async () => {
    const state = createStatefulRepository()
    const options = {
      repository: state.repository,
      grantSecret,
      expectedCompatibility: compatibility,
      now: () => now,
      createGrantId: () => 'grant-jti-1',
    }
    const issued = await issueAgentSpikeOperation(options, actor.id, projectId, {
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
    })
    const persisted = state.getOperation()
    if (!persisted) throw new Error('Stateful repository did not persist the issued operation')
    persisted.status = 'prepared'

    const restored = await restoreAgentSpikeOperationExecution(options, actor.id, operationId)

    expect(restored.operation.status).toBe('prepared')
    expect(restored.input).toEqual(issued.input)
    expect(restored.grant).toBe(issued.grant)
    expect(restored.recoveryGrant).toBe(issued.recoveryGrant)
    expect(state.repository.issueAgentSpikeOperation).toHaveBeenCalledOnce()
  })

  it('does not restore an operation across actors even if the repository returns it', async () => {
    const state = createStatefulRepository()
    const options = {
      repository: state.repository,
      grantSecret,
      expectedCompatibility: compatibility,
      now: () => now,
      createGrantId: () => 'grant-jti-1',
    }
    await issueAgentSpikeOperation(options, actor.id, projectId, {
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
    })

    await expect(
      restoreAgentSpikeOperationExecution(options, '99999999-9999-4999-8999-999999999999', operationId),
    ).rejects.toMatchObject({ status: 404, code: 'AGENT_OPERATION_NOT_FOUND' })
    expect(state.repository.issueAgentSpikeOperation).toHaveBeenCalledOnce()
  })

  it('rejects persisted executor input that no longer matches its operation digest', async () => {
    const state = createStatefulRepository()
    const options = {
      repository: state.repository,
      grantSecret,
      expectedCompatibility: compatibility,
      now: () => now,
      createGrantId: () => 'grant-jti-1',
    }
    await issueAgentSpikeOperation(options, actor.id, projectId, {
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
    })
    const persisted = state.getOperation()
    if (!persisted) throw new Error('Stateful repository did not persist the issued operation')
    persisted.executorInput = { ...persisted.executorInput, taskId: 'task-tampered' }

    await expect(restoreAgentSpikeOperationExecution(options, actor.id, operationId)).rejects.toMatchObject({
      status: 409,
      code: 'AGENT_OPERATION_INTEGRITY_CONFLICT',
    })
    expect(state.repository.issueAgentSpikeOperation).toHaveBeenCalledOnce()
  })

  it('rejects persisted compatibility metadata that diverges from the executor input', async () => {
    const state = createStatefulRepository()
    const options = {
      repository: state.repository,
      grantSecret,
      expectedCompatibility: compatibility,
      now: () => now,
      createGrantId: () => 'grant-jti-1',
    }
    await issueAgentSpikeOperation(options, actor.id, projectId, {
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
    })
    const persisted = state.getOperation()
    if (!persisted) throw new Error('Stateful repository did not persist the issued operation')
    persisted.compatibility = { ...persisted.compatibility, rendererSha256: 'f'.repeat(64) }

    await expect(restoreAgentSpikeOperationExecution(options, actor.id, operationId)).rejects.toMatchObject({
      status: 409,
      code: 'AGENT_OPERATION_INTEGRITY_CONFLICT',
    })
    expect(state.repository.issueAgentSpikeOperation).toHaveBeenCalledOnce()
  })

  it('rejects recovery when persisted input no longer matches the deployed executor compatibility lock', async () => {
    const state = createStatefulRepository()
    const options = {
      repository: state.repository,
      grantSecret,
      expectedCompatibility: compatibility,
      now: () => now,
      createGrantId: () => 'grant-jti-1',
    }
    await issueAgentSpikeOperation(options, actor.id, projectId, {
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
    })

    await expect(
      restoreAgentSpikeOperationExecution(
        {
          ...options,
          expectedCompatibility: { ...compatibility, rendererSha256: 'f'.repeat(64) },
        },
        actor.id,
        operationId,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'AGENT_EXECUTOR_COMPATIBILITY_MISMATCH' })
    expect(state.repository.issueAgentSpikeOperation).toHaveBeenCalledOnce()
  })

  it('returns an explicit error instead of reissuing expired mutation authority', async () => {
    const state = createStatefulRepository()
    const options = {
      repository: state.repository,
      grantSecret,
      expectedCompatibility: compatibility,
      now: () => now,
      createGrantId: () => 'grant-jti-1',
    }
    await issueAgentSpikeOperation(options, actor.id, projectId, {
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
    })

    await expect(
      restoreAgentSpikeOperationExecution(
        { ...options, now: () => new Date(now.getTime() + 301_000) },
        actor.id,
        operationId,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'AGENT_OPERATION_EXPIRED' })
    expect(state.repository.issueAgentSpikeOperation).toHaveBeenCalledOnce()
  })

  it('restores an expired durable operation with a fresh fenced attempt grant and forwards that exact authority', async () => {
    const state = createStatefulRepository()
    const later = new Date(now.getTime() + 301_000)
    const options = {
      repository: state.repository,
      grantSecret,
      expectedCompatibility: compatibility,
      now: () => now,
      createGrantId: () => 'grant-jti-1',
    }
    await issueAgentSpikeOperation(options, actor.id, projectId, {
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
    })
    const attempt = { dispatchId: 'dispatch-1', workerId: 'worker-2', leaseGeneration: 2 }
    const restored = await restoreAgentSpikeOperationExecution(
      { ...options, now: () => later },
      actor.id,
      operationId,
      attempt,
    )
    const replayed = await restoreAgentSpikeOperationExecution(
      { ...options, now: () => later },
      actor.id,
      operationId,
      attempt,
    )
    expect(replayed.grant).toBe(restored.grant)
    const grant = authorizeExecutorPrepare(restored.grant, restored.input, grantSecret, { now: later }).grant
    expect(grant.dispatchAttempt).toEqual(attempt)
    expect(grant.exp - grant.iat).toBe(300)

    const app = createApp({
      env,
      auth: auth(),
      repository: state.repository,
      agentSpike: { now: () => later },
    })
    const response = await app.request(
      executorMutation(
        `/api/agent-spike/operations/${operationId}/prepared`,
        restored.grant,
        'PUT',
        preparedResult(restored.input),
      ),
    )
    expect(response.status).toBe(200)
    expect(state.repository.prepareAgentSpikeOperation).toHaveBeenLastCalledWith(
      actor.id,
      expect.objectContaining({ operationId }),
      { dispatchAttempt: attempt },
      expect.objectContaining({ candidateSchema }),
    )
  })

  it('returns an explicit terminal error for an already committed operation', async () => {
    const state = createStatefulRepository()
    const options = {
      repository: state.repository,
      grantSecret,
      expectedCompatibility: compatibility,
      now: () => now,
      createGrantId: () => 'grant-jti-1',
    }
    await issueAgentSpikeOperation(options, actor.id, projectId, {
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
    })
    const persisted = state.getOperation()
    if (!persisted) throw new Error('Stateful repository did not persist the issued operation')
    persisted.status = 'committed'

    await expect(restoreAgentSpikeOperationExecution(options, actor.id, operationId)).rejects.toMatchObject({
      status: 409,
      code: 'AGENT_OPERATION_ALREADY_COMMITTED',
    })
    expect(state.repository.issueAgentSpikeOperation).toHaveBeenCalledOnce()
  })

  it('returns an explicit terminal error for a failed operation', async () => {
    const state = createStatefulRepository()
    const options = {
      repository: state.repository,
      grantSecret,
      expectedCompatibility: compatibility,
      now: () => now,
      createGrantId: () => 'grant-jti-1',
    }
    await issueAgentSpikeOperation(options, actor.id, projectId, {
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
    })
    const persisted = state.getOperation()
    if (!persisted) throw new Error('Stateful repository did not persist the issued operation')
    persisted.status = 'failed_not_applied'

    await expect(restoreAgentSpikeOperationExecution(options, actor.id, operationId)).rejects.toMatchObject({
      status: 409,
      code: 'AGENT_OPERATION_FAILED',
    })
    expect(state.repository.issueAgentSpikeOperation).toHaveBeenCalledOnce()
  })

  it('persists the bounded Skill trace and rejects replacing it on the same operation', async () => {
    const state = createStatefulRepository()
    const options = {
      repository: state.repository,
      grantSecret,
      expectedCompatibility: compatibility,
      now: () => now,
      createGrantId: () => 'grant-jti-1',
    }
    const trace = {
      promptBundleId: 'easy-dashboard-change-set',
      promptBundleVersion: '1.0.0',
      promptBundleHash: 'a'.repeat(64),
      skills: ['attachment-analysis@1.0.0'],
    }

    const issued = await issueAgentSpikeOperation(options, actor.id, projectId, {
      executorId: 'executor-1',
      operationId,
      taskId: 'task-1',
      stageId: 'stage-1',
      compatibility,
      invocation,
      trace,
    })

    expect(issued.operation.skillTrace).toEqual(trace)
    expect(issued.operation.executorInput).not.toHaveProperty('trace')
    await expect(
      issueAgentSpikeOperation(options, actor.id, projectId, {
        executorId: 'executor-1',
        operationId,
        taskId: 'task-1',
        stageId: 'stage-1',
        compatibility,
        invocation,
        trace: { ...trace, promptBundleHash: 'b'.repeat(64) },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'AGENT_OPERATION_INTEGRITY_CONFLICT' })
  })

  it('issues a restart-safe executor input only to an editable project and keeps the grant outside the browser DTO', async () => {
    const state = createStatefulRepository()
    const app = createApp({
      env,
      auth: auth(),
      repository: state.repository,
      agentSpike: {
        now: () => now,
        createGrantId: () => 'grant-jti-1',
      },
    })

    const response = await app.request(issueRequest())

    expect(response.status).toBe(201)
    const payload = (await response.json()) as {
      operation: { status: string }
      executor: { grant: string; recoveryGrant: string; input: ExecutorPrepareInput }
    }
    expect(payload.operation.status).toBe('issued')
    expect(payload.executor.input).not.toHaveProperty('grant')
    expect(payload.executor.input).not.toHaveProperty('grantToken')
    expect(JSON.stringify(payload.executor.input)).not.toContain('postgresql://')
    expect(state.repository.getEditableProjectForAgentSpike).toHaveBeenCalledWith(actor.id, projectId)
    expect(state.repository.issueAgentSpikeOperation).toHaveBeenCalledWith(
      actor.id,
      expect.objectContaining({
        projectId,
        operationId,
        baseDraftVersion: 4,
        inputDigest: hashExecutorPrepareInput(payload.executor.input),
        executorInput: payload.executor.input,
      }),
    )
    const authorized = authorizeExecutorPrepare(payload.executor.grant, payload.executor.input, grantSecret, { now })
    expect(authorized.grant).toMatchObject({
      iss: 'easy-dashboard-hono',
      operationId,
      actorId: actor.id,
      projectId,
      baseDraftVersion: 4,
      inputSha256: hashExecutorPrepareInput(payload.executor.input),
      compatibilitySha256: hashCompatibilityTuple(compatibility),
      scopes: EXECUTOR_GRANT_SCOPES,
    })
    const recoveryGrant = verifyExecutorRecoveryGrant(payload.executor.recoveryGrant, grantSecret, { now })
    expect(recoveryGrant).toMatchObject({
      iss: 'easy-dashboard-hono',
      operationId,
      actorId: actor.id,
      projectId,
      baseDraftVersion: 4,
      inputSha256: hashExecutorPrepareInput(payload.executor.input),
      compatibilitySha256: hashCompatibilityTuple(compatibility),
      scopes: ['outcome:read'],
    })
    expect(recoveryGrant.jti).toMatch(/^recovery:[a-f0-9]{64}$/)
    expect(recoveryGrant.jti).not.toBe(authorized.grant.jti)
    expect(recoveryGrant.exp - recoveryGrant.iat).toBe(MAX_EXECUTOR_RECOVERY_GRANT_LIFETIME_SECONDS)

    const retryResponse = await app.request(issueRequest())
    expect(retryResponse.status).toBe(201)
    expect(await retryResponse.json()).toEqual(payload)
    expect(state.repository.issueAgentSpikeOperation).toHaveBeenCalledOnce()
  })

  it('does not issue executor authority to a viewer or missing project', async () => {
    const state = createStatefulRepository()
    state.repository.getEditableProjectForAgentSpike = vi.fn(async () => null)
    const app = createApp({
      env,
      auth: auth(),
      repository: state.repository,
      agentSpike: { now: () => now },
    })

    const response = await app.request(issueRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PROJECT_NOT_EDITABLE' } })
    expect(state.repository.issueAgentSpikeOperation).not.toHaveBeenCalled()
  })

  it('rejects a client compatibility tuple that differs from the deployed artifact lock', async () => {
    const state = createStatefulRepository()
    const app = createApp({ env, auth: auth(), repository: state.repository })

    const response = await app.request(
      issueRequest({
        compatibility: {
          ...compatibility,
          rendererSha256: 'f'.repeat(64),
        },
      }),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'AGENT_EXECUTOR_COMPATIBILITY_MISMATCH' },
    })
    expect(state.repository.getEditableProjectForAgentSpike).not.toHaveBeenCalled()
    expect(state.repository.issueAgentSpikeOperation).not.toHaveBeenCalled()
  })

  it('runs input, prepare, commit, and outcome with bearer authority and no user cookie', async () => {
    const state = createStatefulRepository()
    const app = createApp({
      env,
      auth: auth(),
      repository: state.repository,
      agentSpike: {
        now: () => now,
        createGrantId: () => 'grant-jti-1',
      },
    })
    const issueResponse = await app.request(issueRequest())
    const issue = (await issueResponse.json()) as {
      executor: { grant: string; input: ExecutorPrepareInput }
    }

    const inputResponse = await app.request(`/api/agent-spike/operations/${operationId}/input`, {
      headers: { authorization: `Bearer ${issue.executor.grant}` },
    })
    expect(inputResponse.status).toBe(200)
    await expect(inputResponse.json()).resolves.toEqual({ input: issue.executor.input })

    const prepared = preparedResult(issue.executor.input)
    const prepareResponse = await app.request(
      executorMutation(`/api/agent-spike/operations/${operationId}/prepared`, issue.executor.grant, 'PUT', prepared),
    )
    expect(prepareResponse.status).toBe(200)
    await expect(prepareResponse.json()).resolves.toMatchObject({
      outcome: { operationId, status: 'prepared', candidateSha256: prepared.candidateProject.sha256 },
    })

    const commitBody = { candidateSha256: prepared.candidateProject.sha256 }
    const firstCommit = await app.request(
      executorMutation(`/api/agent-spike/operations/${operationId}/commit`, issue.executor.grant, 'POST', commitBody),
    )
    const secondCommit = await app.request(
      executorMutation(`/api/agent-spike/operations/${operationId}/commit`, issue.executor.grant, 'POST', commitBody),
    )
    expect(firstCommit.status).toBe(200)
    expect(secondCommit.status).toBe(200)
    const firstCommitPayload = await firstCommit.json()
    expect(await secondCommit.json()).toEqual(firstCommitPayload)
    expect(state.getCommitCount()).toBe(1)

    const outcomeResponse = await app.request(`/api/agent-spike/operations/${operationId}/outcome`, {
      headers: { authorization: `Bearer ${issue.executor.grant}` },
    })
    expect(outcomeResponse.status).toBe(200)
    const durableOutcome = await outcomeResponse.json()
    expect(durableOutcome).toEqual(firstCommitPayload)
    expect(durableOutcome).toMatchObject({
      outcome: {
        operationId,
        status: 'committed',
        candidateSha256: prepared.candidateProject.sha256,
        committedDraftVersion: 5,
        commitReceipt: {
          receiptVersion: 'easy-dashboard.cas-commit-receipt.v1',
          receiptId: 'ledger-1',
          operationId,
          committedDraftVersion: 5,
          candidateSha256: prepared.candidateProject.sha256,
          repositoryWitness: {
            kind: 'hono.repository.cas',
            transactionId: 'ledger-1',
          },
        },
      },
    })
  })

  it('keeps recovery authority outcome-only after mutation authority expires', async () => {
    const state = createStatefulRepository()
    let clock = now
    const app = createApp({
      env,
      auth: auth(),
      repository: state.repository,
      agentSpike: {
        now: () => clock,
        createGrantId: () => 'grant-jti-1',
      },
    })
    const issueResponse = await app.request(issueRequest())
    const issue = (await issueResponse.json()) as {
      executor: {
        grant: string
        recoveryGrant: string
        input: ExecutorPrepareInput
      }
    }
    const prepared = preparedResult(issue.executor.input)
    const commitBody = { candidateSha256: prepared.candidateProject.sha256 }

    const recoveryInput = await app.request(`/api/agent-spike/operations/${operationId}/input`, {
      headers: { authorization: `Bearer ${issue.executor.recoveryGrant}` },
    })
    expect(recoveryInput.status).toBe(403)
    await expect(recoveryInput.json()).resolves.toMatchObject({
      error: { code: 'AGENT_GRANT_SCOPE_REQUIRED' },
    })

    const recoveryPrepare = await app.request(
      executorMutation(
        `/api/agent-spike/operations/${operationId}/prepared`,
        issue.executor.recoveryGrant,
        'PUT',
        prepared,
      ),
    )
    expect(recoveryPrepare.status).toBe(403)
    await expect(recoveryPrepare.json()).resolves.toMatchObject({
      error: { code: 'AGENT_GRANT_SCOPE_REQUIRED' },
    })

    const recoveryCommit = await app.request(
      executorMutation(
        `/api/agent-spike/operations/${operationId}/commit`,
        issue.executor.recoveryGrant,
        'POST',
        commitBody,
      ),
    )
    expect(recoveryCommit.status).toBe(403)
    await expect(recoveryCommit.json()).resolves.toMatchObject({
      error: { code: 'AGENT_GRANT_SCOPE_REQUIRED' },
    })

    const prepareResponse = await app.request(
      executorMutation(`/api/agent-spike/operations/${operationId}/prepared`, issue.executor.grant, 'PUT', prepared),
    )
    expect(prepareResponse.status).toBe(200)
    const commitResponse = await app.request(
      executorMutation(`/api/agent-spike/operations/${operationId}/commit`, issue.executor.grant, 'POST', commitBody),
    )
    expect(commitResponse.status).toBe(200)
    const committedPayload = await commitResponse.json()

    clock = new Date(now.getTime() + 301_000)
    const expiredInput = await app.request(`/api/agent-spike/operations/${operationId}/input`, {
      headers: { authorization: `Bearer ${issue.executor.grant}` },
    })
    expect(expiredInput.status).toBe(401)
    await expect(expiredInput.json()).resolves.toMatchObject({ error: { code: 'AGENT_GRANT_INVALID' } })

    const expiredCommit = await app.request(
      executorMutation(`/api/agent-spike/operations/${operationId}/commit`, issue.executor.grant, 'POST', commitBody),
    )
    expect(expiredCommit.status).toBe(401)
    await expect(expiredCommit.json()).resolves.toMatchObject({ error: { code: 'AGENT_GRANT_INVALID' } })

    const recoveredOutcome = await app.request(`/api/agent-spike/operations/${operationId}/outcome`, {
      headers: { authorization: `Bearer ${issue.executor.recoveryGrant}` },
    })
    expect(recoveredOutcome.status).toBe(200)
    expect(await recoveredOutcome.json()).toEqual(committedPayload)

    clock = new Date(now.getTime() + (MAX_EXECUTOR_RECOVERY_GRANT_LIFETIME_SECONDS + 1) * 1_000)
    const expiredRecovery = await app.request(`/api/agent-spike/operations/${operationId}/outcome`, {
      headers: { authorization: `Bearer ${issue.executor.recoveryGrant}` },
    })
    expect(expiredRecovery.status).toBe(401)
    await expect(expiredRecovery.json()).resolves.toMatchObject({ error: { code: 'AGENT_GRANT_INVALID' } })
  })

  it('lets unknown executor contract-path failures reach the global 500 handler', async () => {
    const state = createStatefulRepository()
    const app = createApp({
      env,
      auth: auth(),
      repository: state.repository,
      agentSpike: {
        now: () => now,
        createGrantId: () => 'grant-jti-1',
      },
    })
    const issueResponse = await app.request(issueRequest())
    const issue = (await issueResponse.json()) as { executor: { grant: string } }
    const operation = state.getOperation()
    if (!operation) throw new Error('Stateful repository did not persist the issued operation')
    const unexpected = new Error('unexpected executor input failure')
    Object.defineProperty(operation, 'executorInput', {
      get() {
        throw unexpected
      },
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const response = await app.request(`/api/agent-spike/operations/${operationId}/input`, {
        headers: { authorization: `Bearer ${issue.executor.grant}` },
      })

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' },
      })
      expect(consoleError).toHaveBeenCalledWith(unexpected)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('rejects a bearer rebound to another operation before reading the ledger', async () => {
    const state = createStatefulRepository()
    const app = createApp({
      env,
      auth: auth(),
      repository: state.repository,
      agentSpike: {
        now: () => now,
        createGrantId: () => 'grant-jti-1',
      },
    })
    const issueResponse = await app.request(issueRequest())
    const issue = (await issueResponse.json()) as { executor: { grant: string } }
    vi.mocked(state.repository.getAgentSpikeOperationOutcome).mockClear()

    const response = await app.request('/api/agent-spike/operations/operation-2/input', {
      headers: { authorization: `Bearer ${issue.executor.grant}` },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AGENT_GRANT_AUTHORITY_MISMATCH' } })
    expect(state.repository.getAgentSpikeOperationOutcome).not.toHaveBeenCalled()
  })

  it('requires the route-specific grant scope', async () => {
    const state = createStatefulRepository()
    const input: ExecutorPrepareInput = {
      contractVersion: EXECUTOR_CONTRACT_VERSION,
      executorId: 'executor-1',
      operationId,
      projectId,
      actorId: actor.id,
      taskId: 'task-1',
      stageId: 'stage-1',
      baseDraftVersion: 4,
      compatibility,
      baseProject: createDocumentDescriptor(baseSchema),
      invocation,
    }
    const inputSha256 = hashExecutorPrepareInput(input)
    const restrictedGrant = mintExecutorGrant(
      {
        contractVersion: EXECUTOR_CONTRACT_VERSION,
        iss: 'easy-dashboard-hono',
        aud: 'easy-dashboard-document-executor',
        executorId: input.executorId,
        jti: 'grant-jti-restricted',
        operationId,
        projectId,
        actorId: actor.id,
        taskId: input.taskId,
        stageId: input.stageId,
        baseDraftVersion: 4,
        inputSha256,
        compatibilitySha256: hashCompatibilityTuple(compatibility),
        scopes: ['input:read'],
        iat: Math.floor(now.getTime() / 1_000),
        nbf: Math.floor(now.getTime() / 1_000),
        exp: Math.floor(now.getTime() / 1_000) + 300,
      },
      grantSecret,
    )
    const app = createApp({
      env,
      auth: auth(),
      repository: state.repository,
      agentSpike: { now: () => now },
    })

    const response = await app.request(`/api/agent-spike/operations/${operationId}/outcome`, {
      headers: { authorization: `Bearer ${restrictedGrant}` },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AGENT_GRANT_SCOPE_REQUIRED' } })
    expect(state.repository.getAgentSpikeOperationOutcome).not.toHaveBeenCalled()
  })

  it('validates the full prepared result and schema budget before staging it', async () => {
    const state = createStatefulRepository()
    const app = createApp({
      env,
      auth: auth(),
      repository: state.repository,
      agentSpike: {
        now: () => now,
        createGrantId: () => 'grant-jti-1',
      },
    })
    const issueResponse = await app.request(issueRequest())
    const issue = (await issueResponse.json()) as {
      executor: { grant: string; input: ExecutorPrepareInput }
    }
    const invalid = preparedResult(issue.executor.input)
    invalid.candidateProject = {
      ...invalid.candidateProject,
      bytes: invalid.candidateProject.bytes + 1,
    }

    const response = await app.request(
      executorMutation(`/api/agent-spike/operations/${operationId}/prepared`, issue.executor.grant, 'PUT', invalid),
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AGENT_PREPARED_RESULT_INVALID' } })
    expect(state.repository.prepareAgentSpikeOperation).not.toHaveBeenCalled()

    const failedEvidence = preparedResult(issue.executor.input)
    failedEvidence.evidence.consoleErrors.push({
      message: 'Uncaught render error',
      timestampMs: 15,
    })
    const evidenceResponse = await app.request(
      executorMutation(
        `/api/agent-spike/operations/${operationId}/prepared`,
        issue.executor.grant,
        'PUT',
        failedEvidence,
      ),
    )
    expect(evidenceResponse.status).toBe(422)
    await expect(evidenceResponse.json()).resolves.toMatchObject({
      error: { code: 'AGENT_EXECUTOR_EVIDENCE_FAILED' },
    })
    expect(state.repository.prepareAgentSpikeOperation).not.toHaveBeenCalled()
  })

  it('maps stale commit to a deterministic 409 and preserves the ledger outcome', async () => {
    const state = createStatefulRepository()
    const app = createApp({
      env,
      auth: auth(),
      repository: state.repository,
      agentSpike: {
        now: () => now,
        createGrantId: () => 'grant-jti-1',
      },
    })
    const issueResponse = await app.request(issueRequest())
    const issue = (await issueResponse.json()) as {
      executor: { grant: string; input: ExecutorPrepareInput }
    }
    const prepared = preparedResult(issue.executor.input)
    await app.request(
      executorMutation(`/api/agent-spike/operations/${operationId}/prepared`, issue.executor.grant, 'PUT', prepared),
    )
    state.repository.commitAgentSpikeStage = vi.fn(async () => 'conflict' as const)

    const response = await app.request(
      executorMutation(`/api/agent-spike/operations/${operationId}/commit`, issue.executor.grant, 'POST', {
        candidateSha256: prepared.candidateProject.sha256,
      }),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AGENT_DRAFT_STALE' } })
  })

  it('maps a stale executor dispatch attempt to the dedicated 409 code', async () => {
    const state = createStatefulRepository()
    const app = createApp({
      env,
      auth: auth(),
      repository: state.repository,
      agentSpike: { now: () => now, createGrantId: () => 'grant-jti-1' },
    })
    const issueResponse = await app.request(issueRequest())
    const issue = (await issueResponse.json()) as {
      executor: { grant: string; input: ExecutorPrepareInput }
    }
    state.repository.prepareAgentSpikeOperation = vi.fn(async () => 'attempt_stale' as const)

    const response = await app.request(
      executorMutation(
        `/api/agent-spike/operations/${operationId}/prepared`,
        issue.executor.grant,
        'PUT',
        preparedResult(issue.executor.input),
      ),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'AGENT_EXECUTOR_ATTEMPT_STALE' },
    })
  })

  it('fails closed when the executor grant secret is absent', async () => {
    const state = createStatefulRepository()
    const app = createApp({
      env: { ...env, AGENT_EXECUTOR_GRANT_SECRET: undefined },
      auth: auth(),
      repository: state.repository,
    })

    const response = await app.request(issueRequest())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AGENT_SPIKE_UNAVAILABLE' } })
    expect(state.repository.getEditableProjectForAgentSpike).not.toHaveBeenCalled()
  })

  it('fails closed when the deployed executor compatibility lock is absent', async () => {
    const state = createStatefulRepository()
    const app = createApp({
      env: { ...env, AGENT_EXECUTOR_COMPATIBILITY_JSON: undefined },
      auth: auth(),
      repository: state.repository,
    })

    const response = await app.request(issueRequest())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AGENT_SPIKE_UNAVAILABLE' } })
    expect(state.repository.getEditableProjectForAgentSpike).not.toHaveBeenCalled()

    const executorResponse = await app.request(`/api/agent-spike/operations/${operationId}/outcome`)
    expect(executorResponse.status).toBe(503)
    await expect(executorResponse.json()).resolves.toMatchObject({
      error: { code: 'AGENT_SPIKE_UNAVAILABLE' },
    })
    expect(state.repository.getAgentSpikeOperationOutcome).not.toHaveBeenCalled()
  })
})
