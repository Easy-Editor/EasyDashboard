import { describe, expect, it, vi } from 'vitest'
import {
  type ThumbnailCleanupClaim,
  createThumbnailCleanupWorker,
} from '../../../supabase/functions/_shared/thumbnail-cleanup-worker.js'

const artifact: ThumbnailCleanupClaim = {
  artifactId: '11111111-1111-4111-8111-111111111111',
  objectPath: 'owner/project/4/thumbnail.webp',
  signedUploadExpiresAt: new Date('2026-07-30T00:00:00.000Z'),
  databaseNow: new Date('2026-07-30T01:00:00.000Z'),
}

describe('thumbnail cleanup Edge Function worker', () => {
  it('retries a failed Storage deletion and marks the next successful attempt deleted', async () => {
    let now = new Date('2026-07-30T01:00:00.000Z')
    let nextCleanupAt = now.getTime()
    let status: 'cleanup_pending' | 'deleted' = 'cleanup_pending'
    let leaseToken: string | null = null
    let attempt = 0
    const remove = vi.fn(async () => ({ error: ++attempt === 1 ? 'temporary Storage outage' : null }))
    const worker = createThumbnailCleanupWorker({
      claim: async input => {
        if (status !== 'cleanup_pending' || leaseToken || nextCleanupAt > now.getTime()) return []
        leaseToken = input.leaseToken
        return [artifact]
      },
      remove,
      finish: async input => {
        if (status !== 'cleanup_pending' || leaseToken !== input.leaseToken) return 'stale'
        leaseToken = null
        if (input.deletionSucceeded) {
          status = 'deleted'
          return 'deleted'
        }
        nextCleanupAt = now.getTime() + 5 * 60 * 1000
        return 'retry'
      },
      release: async () => 'released',
      newLeaseToken: () => `00000000-0000-4000-8000-00000000000${attempt + 1}`,
    })

    await expect(worker.runBatch()).resolves.toMatchObject({ claimed: 1, retryPending: 1 })
    await expect(worker.runBatch()).resolves.toMatchObject({ claimed: 0 })
    now = new Date(nextCleanupAt)
    await expect(worker.runBatch()).resolves.toMatchObject({ claimed: 1, deleted: 1 })
    expect(remove).toHaveBeenCalledTimes(2)
  })

  it('releases the exact claim for a database-timed retry before an anomalous unexpired delete', async () => {
    const remove = vi.fn(async () => ({ error: null }))
    const finish = vi.fn(async () => 'deleted' as const)
    const release = vi.fn(async () => 'released' as const)
    let claimed = false
    const worker = createThumbnailCleanupWorker({
      claim: async () => {
        if (claimed) return []
        claimed = true
        return [
          {
            ...artifact,
            signedUploadExpiresAt: new Date('2026-07-30T02:00:00.000Z'),
            databaseNow: new Date('2026-07-30T01:00:00.000Z'),
          },
        ]
      },
      remove,
      finish,
      release,
      newLeaseToken: () => '22222222-2222-4222-8222-222222222222',
    })

    await expect(worker.runBatch()).resolves.toMatchObject({
      skippedNotExpired: 1,
      releasedForRetry: 1,
      deleted: 0,
    })
    expect(remove).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledWith({
      artifactId: artifact.artifactId,
      leaseToken: '22222222-2222-4222-8222-222222222222',
      retrySeconds: 30,
    })
  })

  it('uses the database claim clock instead of an Edge runtime clock', async () => {
    const remove = vi.fn(async () => ({ error: null }))
    const release = vi.fn(async () => 'released' as const)
    let claimed = false
    const worker = createThumbnailCleanupWorker({
      claim: async () => {
        if (claimed) return []
        claimed = true
        return [
          {
            ...artifact,
            signedUploadExpiresAt: new Date('2026-07-30T02:00:00.000Z'),
            databaseNow: new Date('2026-07-30T02:00:01.000Z'),
          },
        ]
      },
      remove,
      finish: async () => 'deleted',
      release,
      newLeaseToken: () => '22222222-2222-4222-8222-222222222223',
    })

    await expect(worker.runBatch()).resolves.toMatchObject({ claimed: 1, deleted: 1 })
    expect(remove).toHaveBeenCalledOnce()
    expect(release).not.toHaveBeenCalled()
  })

  it('does not process one artifact twice across concurrent claims', async () => {
    let claimedBy: string | null = null
    let deleted = false
    const tokens = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']
    const remove = vi.fn(async () => ({ error: null }))
    const dependencies = {
      claim: async (input: { leaseToken: string }) => {
        if (deleted || claimedBy) return []
        claimedBy = input.leaseToken
        return [artifact]
      },
      remove,
      finish: async (input: { leaseToken: string }) => {
        if (deleted || claimedBy !== input.leaseToken) return 'stale' as const
        deleted = true
        claimedBy = null
        return 'deleted' as const
      },
      release: async () => 'released' as const,
      newLeaseToken: () => tokens.shift()!,
    }

    const results = await Promise.all([
      createThumbnailCleanupWorker(dependencies).runBatch(),
      createThumbnailCleanupWorker(dependencies).runBatch(),
    ])

    expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(1)
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('claims each object with a fresh lease immediately before deletion', async () => {
    const queued = [
      artifact,
      {
        ...artifact,
        artifactId: '55555555-5555-4555-8555-555555555555',
        objectPath: 'owner/project/4/thumbnail-2.webp',
      },
    ]
    const claimInputs: Array<{ leaseToken: string; limit: number; leaseSeconds: number }> = []
    const finishTokens: string[] = []
    let tokenNumber = 0
    const worker = createThumbnailCleanupWorker(
      {
        claim: async input => {
          claimInputs.push(input)
          const next = queued.shift()
          return next ? [next] : []
        },
        remove: async () => ({ error: null }),
        finish: async input => {
          finishTokens.push(input.leaseToken)
          return 'deleted'
        },
        release: async () => 'released',
        newLeaseToken: () => `lease-${++tokenNumber}`,
      },
      { batchSize: 2 },
    )

    await expect(worker.runBatch()).resolves.toMatchObject({ claimed: 2, deleted: 2 })
    expect(claimInputs).toEqual([
      { leaseToken: 'lease-1', limit: 1, leaseSeconds: 600 },
      { leaseToken: 'lease-2', limit: 1, leaseSeconds: 600 },
    ])
    expect(finishTokens).toEqual(['lease-1', 'lease-2'])
  })
})
