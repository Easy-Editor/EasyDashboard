import { describe, expect, it } from 'vitest'
import {
  agentSpikeCandidateDigest,
  agentSpikeIssueDigest,
  agentSpikePreparedDigest,
  compareAgentSpikeDigest,
} from './agent-stage-commit.js'

describe('agent spike operation integrity', () => {
  it('uses canonical JSON so equivalent object key order has the same digest', () => {
    expect(agentSpikeCandidateDigest({ b: 2, a: { y: true, x: 'value' } })).toBe(
      agentSpikeCandidateDigest({ a: { x: 'value', y: true }, b: 2 }),
    )
  })

  it('binds issue integrity to actor, project, task, stage, executor, operation, input, compatibility, and base version', () => {
    const issue = {
      actorId: 'actor-1',
      projectId: 'project-1',
      taskId: 'task-1',
      stageId: 'stage-1',
      executorId: 'executor-1',
      operationId: 'operation-1',
      grantJti: 'grant-jti-1',
      baseDraftVersion: 4,
      inputDigest: 'a'.repeat(64),
      executorInput: { changeSet: { operations: [] } },
      compatibility: { host: '1.0.0', renderer: '1.0.0' },
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    }
    const digest = agentSpikeIssueDigest(issue)

    expect(agentSpikeIssueDigest({ ...issue })).toBe(digest)
    expect(agentSpikeIssueDigest({ ...issue, stageId: 'stage-2' })).not.toBe(digest)
    expect(agentSpikeIssueDigest({ ...issue, grantJti: 'grant-jti-2' })).not.toBe(digest)
    expect(agentSpikeIssueDigest({ ...issue, baseDraftVersion: 5 })).not.toBe(digest)
    expect(
      agentSpikeIssueDigest({
        ...issue,
        skillTrace: {
          promptBundleId: 'easy-dashboard-change-set',
          promptBundleVersion: '1.0.0',
          promptBundleHash: 'b'.repeat(64),
          skills: ['attachment-analysis@1.0.0'],
        },
      }),
    ).not.toBe(digest)
  })

  it('classifies retries with the same digest as idempotent and different digests as integrity conflicts', () => {
    expect(compareAgentSpikeDigest('a'.repeat(64), 'a'.repeat(64))).toBe('same')
    expect(compareAgentSpikeDigest('a'.repeat(64), 'b'.repeat(64))).toBe('integrity_conflict')
  })

  it('binds prepare integrity to the candidate, complete Host receipt, and evidence', () => {
    const prepared = {
      candidateSchema: { componentsTree: [] },
      hostReceipt: {
        revision: 'host-r1',
        appliedAt: '2026-07-31T10:00:00.000Z',
        affectedPaths: ['/editorSchema/componentsTree/0'],
      },
      evidence: {
        rendererRevision: 'renderer-r1',
        capturedAt: '2026-07-31T10:00:01.000Z',
      },
    }
    const digest = agentSpikePreparedDigest(prepared)

    expect(agentSpikePreparedDigest(structuredClone(prepared))).toBe(digest)
    expect(
      agentSpikePreparedDigest({
        ...prepared,
        hostReceipt: { ...prepared.hostReceipt, revision: 'host-r2' },
      }),
    ).not.toBe(digest)
    expect(
      agentSpikePreparedDigest({
        ...prepared,
        evidence: { ...prepared.evidence, capturedAt: '2026-07-31T10:00:02.000Z' },
      }),
    ).not.toBe(digest)
  })
})
