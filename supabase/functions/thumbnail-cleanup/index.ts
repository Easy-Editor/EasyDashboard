import { createClient } from 'npm:@supabase/supabase-js@2.111.0'
import { createThumbnailCleanupWorker } from '../_shared/thumbnail-cleanup-worker.ts'

const THUMBNAIL_BUCKET = 'easy-dashboard-thumbnails'

function matchesBearerSecret(authorization: string | null, secret: string): boolean {
  if (!authorization) return false
  const expected = `Bearer ${secret}`
  let mismatch = authorization.length ^ expected.length
  const length = Math.max(authorization.length, expected.length)
  for (let index = 0; index < length; index += 1) {
    mismatch |= (authorization.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0)
  }
  return mismatch === 0
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

Deno.serve(async request => {
  if (request.method !== 'POST') {
    return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }, 405)
  }

  const cronSecret = Deno.env.get('THUMBNAIL_CLEANUP_CRON_SECRET')
  if (!cronSecret || !matchesBearerSecret(request.headers.get('Authorization'), cronSecret)) {
    return json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      {
        error: {
          code: 'THUMBNAIL_CLEANUP_UNAVAILABLE',
          message: 'Thumbnail cleanup worker is not configured',
        },
      },
      503,
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const storage = supabase.storage.from(THUMBNAIL_BUCKET)
  const worker = createThumbnailCleanupWorker({
    async claim({ leaseToken, limit, leaseSeconds }) {
      const { data, error } = await supabase.rpc('claim_thumbnail_cleanup_v2', {
        claim_token: leaseToken,
        claim_limit: limit,
        lease_seconds: leaseSeconds,
      })
      if (error) throw error
      return (data ?? []).map(row => ({
        artifactId: row.artifact_id as string,
        objectPath: row.object_path as string,
        signedUploadExpiresAt: new Date(row.signed_upload_expires_at as string),
        databaseNow: new Date(row.database_now as string),
      }))
    },
    async remove(objectPath) {
      const { error } = await storage.remove([objectPath])
      return { error: error?.message ? error.message.slice(0, 500) : null }
    },
    async finish({ artifactId, leaseToken, deletionSucceeded, failureMessage }) {
      const { data, error } = await supabase.rpc('finish_thumbnail_cleanup', {
        target_artifact_id: artifactId,
        claim_token: leaseToken,
        deletion_succeeded: deletionSucceeded,
        failure_message: failureMessage,
      })
      if (error) throw error
      if (data === 'deleted' || data === 'retry' || data === 'stale') return data
      return 'stale'
    },
    async release({ artifactId, leaseToken, retrySeconds }) {
      const { data, error } = await supabase.rpc('release_thumbnail_cleanup', {
        target_artifact_id: artifactId,
        claim_token: leaseToken,
        retry_seconds: retrySeconds,
      })
      if (error) throw error
      return data === 'released' ? 'released' : 'stale'
    },
    newLeaseToken: () => crypto.randomUUID(),
  })

  try {
    return json({ cleanup: await worker.runBatch() })
  } catch (error) {
    console.error('thumbnail cleanup failed', error instanceof Error ? error.message : 'unknown error')
    return json({ error: { code: 'THUMBNAIL_CLEANUP_FAILED', message: 'Thumbnail cleanup failed' } }, 500)
  }
})
