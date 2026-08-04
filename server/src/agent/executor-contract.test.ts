import { describe, expect, it } from 'vitest'
import {
  EXECUTOR_CONTRACT_VERSION,
  EXECUTOR_GRANT_AUDIENCE,
  EXECUTOR_GRANT_ISSUER,
  type ExecutorGrantPayload,
  type ExecutorGrantScope,
  type ExecutorPrepareInput,
  type ExecutorPreparedResult,
  MAX_EXECUTOR_RECOVERY_GRANT_LIFETIME_SECONDS,
  authorizeExecutorPrepare,
  createDocumentDescriptor,
  hashCompatibilityTuple,
  hashExecutorPrepareInput,
  mintExecutorGrant,
  parseExecutorPrepareInput,
  validatePreparedResult,
  verifyExecutorGrant,
  verifyExecutorGrantForScope,
  verifyExecutorRecoveryGrant,
} from './executor-contract.js'

const secret = 'm0-test-secret-that-is-at-least-thirty-two-bytes'

function grantPayload(overrides: Partial<ExecutorGrantPayload> = {}): ExecutorGrantPayload {
  return {
    contractVersion: EXECUTOR_CONTRACT_VERSION,
    iss: EXECUTOR_GRANT_ISSUER,
    aud: EXECUTOR_GRANT_AUDIENCE,
    executorId: 'executor-1',
    jti: 'grant-jti-1',
    operationId: 'operation-1',
    projectId: 'project-1',
    actorId: 'actor-1',
    taskId: 'task-1',
    stageId: 'stage-1',
    baseDraftVersion: 7,
    inputSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    compatibilitySha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    scopes: ['input:read', 'candidate:prepare', 'commit:request', 'outcome:read'],
    iat: 1_800_000_000,
    nbf: 1_800_000_000,
    exp: 1_800_000_300,
    ...overrides,
  }
}

const compatibility = {
  runtimeVersion: '0.1.0-m0',
  runtimeSha256: '1111111111111111111111111111111111111111111111111111111111111111',
  coreVersion: '1.2.3',
  coreSha256: '2222222222222222222222222222222222222222222222222222222222222222',
  rendererVersion: '2.0.0',
  rendererSha256: '3333333333333333333333333333333333333333333333333333333333333333',
  dashboardAgentHostVersion: '0.1.0-m0',
  dashboardAgentHostSha256: '4444444444444444444444444444444444444444444444444444444444444444',
  browserArtifactVersion: '0.0.0-m0',
  browserArtifactSha256: '6666666666666666666666666666666666666666666666666666666666666666',
  materialManifestVersion: 'manifest-2026-07-31',
  materialManifestSha256: '5555555555555555555555555555555555555555555555555555555555555555',
}

function prepareInput(overrides: Partial<ExecutorPrepareInput> = {}): ExecutorPrepareInput {
  return {
    contractVersion: EXECUTOR_CONTRACT_VERSION,
    executorId: 'executor-1',
    operationId: 'operation-1',
    projectId: 'project-1',
    actorId: 'actor-1',
    taskId: 'task-1',
    stageId: 'stage-1',
    baseDraftVersion: 7,
    compatibility,
    baseProject: {
      schema: {
        componentsTree: [],
      },
      bytes: 21,
      sha256: '0e1827118c45d5b8b3cbbf89daa4188f754395a54b414f19d7e900eb0e502fa8',
    },
    invocation: {
      sessionId: 'session-1',
      stepId: 'step-1',
      callId: 'screen-call-1',
      capability: 'screen.applyChangeSet',
      arguments: {
        schemaVersion: 1,
        documentId: 'document-1',
        operations: [
          {
            opId: 'insert-title',
            type: 'insert',
            parentId: 'root',
            componentName: 'Text',
            fields: {
              text: 'Flight Operations',
            },
          },
        ],
      },
    },
    ...overrides,
  }
}

function preparedResult(overrides: Partial<ExecutorPreparedResult> = {}): ExecutorPreparedResult {
  const input = prepareInput()
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
    compatibility,
    candidateProject: {
      schema: {
        componentsTree: [{ id: 'title' }],
      },
      bytes: 35,
      sha256: '91668be26148db7d674e116d024ed12b1937cf0a104565d35bc5fa0b750a59f1',
    },
    semanticReceipt: {
      schemaVersion: 1,
      projectId: input.projectId,
      branchId: 'draft',
      callId: input.invocation.callId,
      status: 'applied',
      revision: 'host-revision-8',
      witness: {
        kind: 'screen-change-set-applied',
      },
    },
    evidence: {
      console: [
        {
          level: 'info',
          message: 'Dashboard host prepared the candidate document',
          timestampMs: 125,
        },
      ],
      render: {
        status: 'rendered',
        rendererReady: true,
        viewport: {
          width: 1920,
          height: 1080,
        },
        durationMs: 250,
        screenshotSha256: '8e8cf868b4b863f8450c122041cfb19e46b1d545cc750d7537931bc141daefb8',
        layout: {
          status: 'passed',
          targetViewport: { width: 1920, height: 1080 },
          browserViewport: { width: 1920, height: 1080 },
          simulatorViewport: { x: 0, y: 0, width: 1920, height: 1080 },
          viewportMatchesTarget: true,
          componentElementCount: 1,
          visibleElementCount: 1,
          hiddenElementCount: 0,
          zeroAreaElementCount: 0,
          overflowingElementCount: 0,
          clippedElementCount: 0,
          documentOverflow: { horizontal: false, vertical: false },
        },
        resourceErrors: [],
      },
      consoleErrors: [],
      requestFailures: [],
      materials: {
        manifestVersion: compatibility.materialManifestVersion,
        loaded: [
          {
            materialId: 'text',
            version: '1.0.0',
          },
        ],
        missing: [],
      },
      request: {
        requestId: 'executor-request-1',
        startedAt: '2027-01-15T08:01:59.500Z',
        completedAt: '2027-01-15T08:02:00.000Z',
      },
      timing: {
        totalMs: 500,
        hostStartupMs: 150,
        applyChangeSetMs: 100,
        exportMs: 50,
      },
    },
    preRevision: 'host-revision-7',
    postRevision: 'host-revision-8',
    preparedAt: '2027-01-15T08:02:00.000Z',
    ...overrides,
  }
}

describe('executor grant', () => {
  it('strictly signs dispatch-attempt authority and rejects malformed or recovery-bound attempts', () => {
    const dispatchAttempt = { dispatchId: 'dispatch-1', workerId: 'worker-1', leaseGeneration: 2 }
    const token = mintExecutorGrant(grantPayload({ dispatchAttempt }), secret)

    expect(verifyExecutorGrant(token, secret, { now: 1_800_000_120 }).dispatchAttempt).toEqual(dispatchAttempt)
    expect(() =>
      mintExecutorGrant(grantPayload({ dispatchAttempt: { ...dispatchAttempt, leaseGeneration: 0 } }), secret),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONTRACT' }))
    expect(() =>
      mintExecutorGrant(
        grantPayload({
          dispatchAttempt,
          scopes: ['outcome:read'],
          exp: 1_800_000_600,
        }),
        secret,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONTRACT' }))

    const [prefix, payload, signature] = token.split('.')
    const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as ExecutorGrantPayload
    decoded.dispatchAttempt = { ...dispatchAttempt, leaseGeneration: 3 }
    const tampered = `${prefix}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`
    expect(() => verifyExecutorGrant(tampered, secret, { now: 1_800_000_120 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_GRANT_SIGNATURE' }),
    )
  })

  it('mints and verifies a strict, versioned, short-lived HMAC grant', () => {
    const token = mintExecutorGrant(grantPayload(), secret)

    expect(
      verifyExecutorGrant(token, secret, {
        now: 1_800_000_120,
      }),
    ).toEqual(grantPayload())

    expect(() =>
      mintExecutorGrant(
        {
          ...grantPayload(),
          databaseUrl: 'postgres://executor-must-not-see-this',
        } as ExecutorGrantPayload,
        secret,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_CONTRACT',
      }),
    )

    expect(() =>
      mintExecutorGrant(
        grantPayload({
          exp: 1_800_000_301,
        }),
        secret,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_GRANT_LIFETIME',
      }),
    )

    expect(() =>
      mintExecutorGrant(
        {
          ...grantPayload(),
          iss: 'untrusted-issuer',
        } as unknown as ExecutorGrantPayload,
        secret,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_CONTRACT',
      }),
    )
  })

  it('rejects expired and tampered grants', () => {
    const token = mintExecutorGrant(grantPayload(), secret)

    expect(() => verifyExecutorGrant(token, secret, { now: 1_800_000_301 })).toThrowError(
      expect.objectContaining({
        code: 'GRANT_EXPIRED',
      }),
    )

    const parts = token.split('.')
    const signature = parts.at(-1)
    const replacement = signature?.endsWith('a') ? 'b' : 'a'
    const tampered = `${parts.slice(0, -1).join('.')}.${signature?.slice(0, -1)}${replacement}`

    expect(() => verifyExecutorGrant(tampered, secret, { now: 1_800_000_120 })).toThrowError(
      expect.objectContaining({
        code: 'INVALID_GRANT_SIGNATURE',
      }),
    )
  })

  it('enforces exact route scopes without consuming the one-time operation', () => {
    const readonlyGrant = grantPayload({
      scopes: ['input:read'],
    })
    const token = mintExecutorGrant(readonlyGrant, secret)

    expect(verifyExecutorGrantForScope(token, secret, 'input:read', { now: 1_800_000_120 })).toEqual(readonlyGrant)
    expect(verifyExecutorGrantForScope(token, secret, 'input:read', { now: 1_800_000_120 })).toEqual(readonlyGrant)
    expect(() =>
      verifyExecutorGrantForScope(token, secret, 'candidate:prepare', {
        now: 1_800_000_120,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INSUFFICIENT_GRANT_SCOPE',
      }),
    )

    const exactScopes: ExecutorGrantScope[] = ['input:read', 'candidate:prepare', 'commit:request', 'outcome:read']
    expect(exactScopes).toEqual(grantPayload().scopes)
  })

  it('allows a bounded outcome-only recovery grant after mutation authority expires', () => {
    const mutationToken = mintExecutorGrant(grantPayload(), secret)
    const recoveryGrant = grantPayload({
      scopes: ['outcome:read'],
      exp: 1_800_000_000 + MAX_EXECUTOR_RECOVERY_GRANT_LIFETIME_SECONDS,
    })
    const recoveryToken = mintExecutorGrant(recoveryGrant, secret)
    const recoveryTime = 1_800_000_600

    expect(() => verifyExecutorGrant(mutationToken, secret, { now: recoveryTime })).toThrowError(
      expect.objectContaining({
        code: 'GRANT_EXPIRED',
      }),
    )
    expect(verifyExecutorRecoveryGrant(recoveryToken, secret, { now: recoveryTime })).toEqual(recoveryGrant)
    expect(verifyExecutorGrantForScope(recoveryToken, secret, 'outcome:read', { now: recoveryTime })).toEqual(
      recoveryGrant,
    )
    expect(() =>
      verifyExecutorGrantForScope(recoveryToken, secret, 'input:read', {
        now: recoveryTime,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INSUFFICIENT_GRANT_SCOPE',
      }),
    )
    expect(() =>
      verifyExecutorGrantForScope(recoveryToken, secret, 'candidate:prepare', {
        now: recoveryTime,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INSUFFICIENT_GRANT_SCOPE',
      }),
    )
    expect(() =>
      verifyExecutorGrantForScope(recoveryToken, secret, 'commit:request', {
        now: recoveryTime,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INSUFFICIENT_GRANT_SCOPE',
      }),
    )
  })

  it('rejects recovery TTL overflow and any longer-lived mixed-scope grant', () => {
    expect(() =>
      mintExecutorGrant(
        grantPayload({
          scopes: ['outcome:read'],
          exp: 1_800_000_001 + MAX_EXECUTOR_RECOVERY_GRANT_LIFETIME_SECONDS,
        }),
        secret,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_GRANT_LIFETIME',
      }),
    )

    expect(() =>
      mintExecutorGrant(
        grantPayload({
          scopes: ['outcome:read', 'input:read'],
          exp: 1_800_001_000,
        }),
        secret,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_GRANT_LIFETIME',
      }),
    )

    const allScopeToken = mintExecutorGrant(grantPayload(), secret)
    expect(() =>
      verifyExecutorRecoveryGrant(allScopeToken, secret, {
        now: 1_800_000_120,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_RECOVERY_GRANT_SCOPE',
      }),
    )
  })
})

describe('executor prepare contract', () => {
  it('parses a strict prepare input and verifies grant authority', () => {
    const input = prepareInput()
    const grant = grantPayload({
      inputSha256: hashExecutorPrepareInput(input),
      compatibilitySha256: hashCompatibilityTuple(input.compatibility),
    })
    const token = mintExecutorGrant(grant, secret)

    expect(
      authorizeExecutorPrepare(token, input, secret, {
        now: 1_800_000_120,
      }),
    ).toEqual({
      input,
      grant,
    })

    expect(() =>
      parseExecutorPrepareInput({
        ...input,
        compatibility: {
          ...input.compatibility,
          unknownRuntimeFlag: true,
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_CONTRACT',
      }),
    )

    expect(() =>
      parseExecutorPrepareInput({
        ...input,
        invocation: {
          ...input.invocation,
          arguments: {
            ...input.invocation.arguments,
            operations: [input.invocation.arguments.operations[0], input.invocation.arguments.operations[0]],
          },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_CONTRACT',
      }),
    )

    expect(() =>
      parseExecutorPrepareInput({
        ...input,
        invocation: {
          ...input.invocation,
          expectedRevision: 'server-must-not-supply-host-revision',
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_CONTRACT',
      }),
    )
  })

  it('rejects mismatched authority and database credential fields at any depth', () => {
    const input = prepareInput()
    const grant = grantPayload({
      inputSha256: hashExecutorPrepareInput(input),
      compatibilitySha256: hashCompatibilityTuple(input.compatibility),
    })
    const token = mintExecutorGrant(grant, secret)

    expect(() =>
      authorizeExecutorPrepare(
        token,
        {
          ...input,
          baseDraftVersion: input.baseDraftVersion + 1,
        },
        secret,
        { now: 1_800_000_120 },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'AUTHORITY_MISMATCH',
      }),
    )

    expect(() =>
      parseExecutorPrepareInput({
        ...input,
        baseProject: {
          ...input.baseProject,
          schema: {
            componentsTree: [],
            dataSource: {
              databaseCredentials: 'must-never-reach-the-executor',
            },
          },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'DATABASE_CREDENTIAL_FORBIDDEN',
      }),
    )
  })

  it('creates deterministic document descriptors and rejects inconsistent base descriptors', () => {
    expect(
      createDocumentDescriptor({
        componentsTree: [],
      }),
    ).toEqual({
      schema: {
        componentsTree: [],
      },
      bytes: 21,
      sha256: '0e1827118c45d5b8b3cbbf89daa4188f754395a54b414f19d7e900eb0e502fa8',
    })

    const input = prepareInput()
    expect(() =>
      parseExecutorPrepareInput({
        ...input,
        baseProject: {
          ...input.baseProject,
          bytes: input.baseProject.bytes + 1,
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'DOCUMENT_DESCRIPTOR_MISMATCH',
      }),
    )
  })

  it('accepts a fully evidenced prepared result and rejects result drift', () => {
    const input = prepareInput()
    const result = preparedResult()

    expect(validatePreparedResult(input, result)).toEqual(result)

    expect(() =>
      validatePreparedResult(input, {
        ...result,
        compatibility: {
          ...result.compatibility,
          rendererVersion: 'unexpected-renderer',
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'RESULT_MISMATCH',
      }),
    )

    expect(() =>
      validatePreparedResult(input, {
        ...result,
        semanticReceipt: {
          ...result.semanticReceipt,
          receiptVersion: 'invented-receipt-shape',
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_CONTRACT',
      }),
    )

    expect(() =>
      validatePreparedResult(input, {
        ...result,
        semanticReceipt: {
          ...result.semanticReceipt,
          revision: 'host-revision-tampered',
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'RESULT_MISMATCH',
      }),
    )

    expect(() =>
      validatePreparedResult(input, {
        ...result,
        candidateProject: {
          ...result.candidateProject,
          schema: {
            componentsTree: [],
          },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'DOCUMENT_DESCRIPTOR_MISMATCH',
      }),
    )
  })
})
