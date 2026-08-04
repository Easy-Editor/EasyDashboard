import { describe, expect, it } from 'vitest'
import {
  type DurableCommitReceipt,
  EXECUTOR_CONTRACT_VERSION,
  type ExecutorPrepareInput,
  type ExecutorPreparedResult,
  createDocumentDescriptor,
  hashCompatibilityTuple,
  hashExecutorPrepareInput,
} from './executor-contract.js'
import { classifyExecutorRecovery } from './executor-recovery.js'

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

function prepareInput(): ExecutorPrepareInput {
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
    baseProject: createDocumentDescriptor({
      componentsTree: [],
    }),
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
  }
}

function preparedResult(): ExecutorPreparedResult {
  const input = prepareInput()
  const candidate = createDocumentDescriptor({
    componentsTree: [{ id: 'title' }],
  })
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
    candidateProject: candidate,
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
      console: [],
      consoleErrors: [],
      requestFailures: [],
      render: {
        status: 'rendered',
        rendererReady: true,
        viewport: {
          width: 1920,
          height: 1080,
        },
        durationMs: 200,
        screenshotSha256: '8e8cf868b4b863f8450c122041cfb19e46b1d545cc750d7537931bc141daefb8',
        resourceErrors: [],
      },
      materials: {
        manifestVersion: compatibility.materialManifestVersion,
        loaded: [],
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
  }
}

function durableReceipt(): DurableCommitReceipt {
  const result = preparedResult()
  return {
    contractVersion: EXECUTOR_CONTRACT_VERSION,
    receiptVersion: 'easy-dashboard.cas-commit-receipt.v1',
    receiptId: 'receipt-1',
    operationId: result.operationId,
    projectId: result.projectId,
    actorId: result.actorId,
    taskId: result.taskId,
    stageId: result.stageId,
    baseDraftVersion: result.baseDraftVersion,
    committedDraftVersion: result.baseDraftVersion + 1,
    inputSha256: result.inputSha256,
    compatibilitySha256: result.compatibilitySha256,
    candidateSha256: result.candidateProject.sha256,
    candidateBytes: result.candidateProject.bytes,
    committedAt: '2027-01-15T08:02:01.000Z',
    repositoryWitness: {
      kind: 'hono.repository.cas',
      transactionId: 'transaction-1',
    },
  }
}

function observation(prepare: Record<string, unknown>, commit: Record<string, unknown>): Record<string, unknown> {
  return {
    contractVersion: EXECUTOR_CONTRACT_VERSION,
    operationId: 'operation-1',
    projectId: 'project-1',
    actorId: 'actor-1',
    taskId: 'task-1',
    stageId: 'stage-1',
    prepare,
    commit,
  }
}

describe('classifyExecutorRecovery', () => {
  it('classifies not_applied and prepared before a commit starts', () => {
    expect(
      classifyExecutorRecovery(
        observation(
          {
            status: 'not_started',
          },
          {
            status: 'not_started',
          },
        ),
      ),
    ).toBe('not_applied')

    expect(
      classifyExecutorRecovery(
        observation(
          {
            status: 'prepared',
            result: preparedResult(),
          },
          {
            status: 'not_started',
          },
        ),
      ),
    ).toBe('prepared')
  })

  it('classifies a started commit without a durable receipt as indeterminate', () => {
    expect(
      classifyExecutorRecovery(
        observation(
          {
            status: 'prepared',
            result: preparedResult(),
          },
          {
            status: 'started',
            attemptId: 'commit-attempt-1',
            startedAt: '2027-01-15T08:02:00.500Z',
          },
        ),
      ),
    ).toBe('indeterminate')
  })

  it('requires a consistent durable Hono receipt before classifying committed', () => {
    expect(
      classifyExecutorRecovery(
        observation(
          {
            status: 'prepared',
            result: preparedResult(),
          },
          {
            status: 'receipted',
            receipt: durableReceipt(),
          },
        ),
      ),
    ).toBe('committed')

    expect(() =>
      classifyExecutorRecovery(
        observation(
          {
            status: 'prepared',
            result: preparedResult(),
          },
          {
            status: 'receipted',
            receipt: {
              ...durableReceipt(),
              candidateSha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            },
          },
        ),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'RECOVERY_EVIDENCE_MISMATCH',
      }),
    )
  })

  it('uses an authoritative rejection as not_applied', () => {
    expect(
      classifyExecutorRecovery(
        observation(
          {
            status: 'prepared',
            result: preparedResult(),
          },
          {
            status: 'rejected',
            reason: 'stale',
            decidedAt: '2027-01-15T08:02:01.000Z',
            repositoryWitness: {
              kind: 'hono.repository.rejection',
              decisionId: 'decision-1',
            },
          },
        ),
      ),
    ).toBe('not_applied')
  })

  it('rejects schema-equality hints instead of inferring committed', () => {
    expect(() =>
      classifyExecutorRecovery({
        ...observation(
          {
            status: 'prepared',
            result: preparedResult(),
          },
          {
            status: 'started',
            attemptId: 'commit-attempt-1',
            startedAt: '2027-01-15T08:02:00.500Z',
          },
        ),
        currentSchemaSha256: preparedResult().candidateProject.sha256,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_RECOVERY_EVIDENCE',
      }),
    )
  })
})
