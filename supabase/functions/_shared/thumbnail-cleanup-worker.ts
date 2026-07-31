export interface ThumbnailCleanupClaim {
  artifactId: string
  objectPath: string
  signedUploadExpiresAt: Date
  databaseNow: Date
}

export interface ThumbnailCleanupResult {
  claimed: number
  deleted: number
  retryPending: number
  skippedNotExpired: number
  releasedForRetry: number
  staleClaims: number
}

export interface ThumbnailCleanupWorkerDependencies {
  claim(input: { leaseToken: string; limit: number; leaseSeconds: number }): Promise<ThumbnailCleanupClaim[]>
  remove(objectPath: string): Promise<{ error: string | null }>
  finish(input: {
    artifactId: string
    leaseToken: string
    deletionSucceeded: boolean
    failureMessage: string | null
  }): Promise<'deleted' | 'retry' | 'stale'>
  release(input: {
    artifactId: string
    leaseToken: string
    retrySeconds: number
  }): Promise<'released' | 'stale'>
  newLeaseToken(): string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 500)
  return 'storage-delete-failed'
}

export function createThumbnailCleanupWorker(
  dependencies: ThumbnailCleanupWorkerDependencies,
  options: { batchSize?: number; leaseSeconds?: number } = {},
) {
  const batchSize = options.batchSize ?? 50
  const leaseSeconds = options.leaseSeconds ?? 600

  return {
    async runBatch(): Promise<ThumbnailCleanupResult> {
      const result: ThumbnailCleanupResult = {
        claimed: 0,
        deleted: 0,
        retryPending: 0,
        skippedNotExpired: 0,
        releasedForRetry: 0,
        staleClaims: 0,
      }

      // Claim one row immediately before deleting it. A single lease therefore
      // never waits behind the other objects in the batch, and a slow earlier
      // deletion cannot make later claims expire in the queue.
      for (let index = 0; index < batchSize; index += 1) {
        const leaseToken = dependencies.newLeaseToken()
        const [claim] = await dependencies.claim({ leaseToken, limit: 1, leaseSeconds })
        if (!claim) break
        result.claimed += 1

        // The claim RPC already excludes these rows. Keep a second guard at
        // the irreversible Storage boundary using the database clock returned
        // by that same claim transaction. Never compare against the Edge
        // runtime clock: clock skew must not strand a live database lease.
        if (claim.signedUploadExpiresAt.getTime() > claim.databaseNow.getTime()) {
          result.skippedNotExpired += 1
          const outcome = await dependencies.release({
            artifactId: claim.artifactId,
            leaseToken,
            retrySeconds: 30,
          })
          if (outcome === 'released') result.releasedForRetry += 1
          else result.staleClaims += 1
          continue
        }

        let failureMessage: string | null = null
        try {
          const removal = await dependencies.remove(claim.objectPath)
          failureMessage = removal.error
        } catch (error) {
          failureMessage = errorMessage(error)
        }

        const outcome = await dependencies.finish({
          artifactId: claim.artifactId,
          leaseToken,
          deletionSucceeded: failureMessage === null,
          failureMessage,
        })
        if (outcome === 'deleted') result.deleted += 1
        else if (outcome === 'retry') result.retryPending += 1
        else result.staleClaims += 1
      }

      return result
    },
  }
}
