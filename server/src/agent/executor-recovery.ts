import { z } from 'zod'
import {
  type DurableCommitReceipt,
  EXECUTOR_CONTRACT_VERSION,
  ExecutorContractError,
  type ExecutorPreparedResult,
  durableCommitReceiptSchema,
  executorPreparedResultSchema,
  parseDurableCommitReceipt,
  parseExecutorPreparedResult,
} from './executor-contract.js'

export type ExecutorRecoveryClassification = 'not_applied' | 'prepared' | 'committed' | 'indeterminate'

const identifierSchema = z.string().trim().min(1).max(160)

const prepareObservationSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('not_started'),
    })
    .strict(),
  z
    .object({
      status: z.literal('prepared'),
      result: executorPreparedResultSchema,
    })
    .strict(),
])

const commitObservationSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('not_started'),
    })
    .strict(),
  z
    .object({
      status: z.literal('started'),
      attemptId: identifierSchema,
      startedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      status: z.literal('rejected'),
      reason: z.enum(['stale', 'unauthorized', 'invalid_candidate', 'operation_conflict']),
      decidedAt: z.string().datetime({ offset: true }),
      repositoryWitness: z
        .object({
          kind: z.literal('hono.repository.rejection'),
          decisionId: identifierSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      status: z.literal('receipted'),
      receipt: durableCommitReceiptSchema,
    })
    .strict(),
])

export const executorRecoveryObservationSchema = z
  .object({
    contractVersion: z.literal(EXECUTOR_CONTRACT_VERSION),
    operationId: identifierSchema,
    projectId: identifierSchema,
    actorId: identifierSchema,
    taskId: identifierSchema,
    stageId: identifierSchema,
    prepare: prepareObservationSchema,
    commit: commitObservationSchema,
  })
  .strict()

export type ExecutorRecoveryObservation = z.infer<typeof executorRecoveryObservationSchema>

export type ExecutorRecoveryErrorCode = 'INVALID_RECOVERY_EVIDENCE' | 'RECOVERY_EVIDENCE_MISMATCH'

export class ExecutorRecoveryError extends Error {
  constructor(
    public readonly code: ExecutorRecoveryErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ExecutorRecoveryError'
  }
}

function parseObservation(value: unknown): ExecutorRecoveryObservation {
  const result = executorRecoveryObservationSchema.safeParse(value)
  if (!result.success) {
    throw new ExecutorRecoveryError(
      'INVALID_RECOVERY_EVIDENCE',
      'Recovery evidence does not match the strict executor recovery contract',
      result.error,
    )
  }
  return result.data
}

function preparedMatchesObservation(observation: ExecutorRecoveryObservation, result: ExecutorPreparedResult): boolean {
  return (
    observation.operationId === result.operationId &&
    observation.projectId === result.projectId &&
    observation.actorId === result.actorId &&
    observation.taskId === result.taskId &&
    observation.stageId === result.stageId
  )
}

function receiptMatchesPrepared(result: ExecutorPreparedResult, receipt: DurableCommitReceipt): boolean {
  return (
    receipt.operationId === result.operationId &&
    receipt.projectId === result.projectId &&
    receipt.actorId === result.actorId &&
    receipt.taskId === result.taskId &&
    receipt.stageId === result.stageId &&
    receipt.baseDraftVersion === result.baseDraftVersion &&
    receipt.committedDraftVersion === result.baseDraftVersion + 1 &&
    receipt.inputSha256 === result.inputSha256 &&
    receipt.compatibilitySha256 === result.compatibilitySha256 &&
    receipt.candidateSha256 === result.candidateProject.sha256 &&
    receipt.candidateBytes === result.candidateProject.bytes
  )
}

export function classifyExecutorRecovery(value: unknown): ExecutorRecoveryClassification {
  const observation = parseObservation(value)
  let prepared: ExecutorPreparedResult | undefined
  if (observation.prepare.status === 'prepared') {
    try {
      prepared = parseExecutorPreparedResult(observation.prepare.result)
    } catch (error) {
      if (error instanceof ExecutorContractError) {
        throw new ExecutorRecoveryError('INVALID_RECOVERY_EVIDENCE', error.message, error)
      }
      throw error
    }
    if (!preparedMatchesObservation(observation, prepared)) {
      throw new ExecutorRecoveryError(
        'RECOVERY_EVIDENCE_MISMATCH',
        'Prepared result identity does not match the recovery observation',
      )
    }
  }

  if (observation.commit.status === 'receipted') {
    if (!prepared) {
      throw new ExecutorRecoveryError(
        'RECOVERY_EVIDENCE_MISMATCH',
        'A durable commit receipt must be linked to a prepared result',
      )
    }
    const receipt = parseDurableCommitReceipt(observation.commit.receipt)
    if (!receiptMatchesPrepared(prepared, receipt)) {
      throw new ExecutorRecoveryError(
        'RECOVERY_EVIDENCE_MISMATCH',
        'Durable commit receipt does not match the prepared result',
      )
    }
    return 'committed'
  }

  if (observation.commit.status === 'started') {
    return 'indeterminate'
  }

  if (observation.commit.status === 'rejected') {
    return 'not_applied'
  }

  return prepared ? 'prepared' : 'not_applied'
}
