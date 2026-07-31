import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const initialMigration = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/20260729052216_initial_app_schema.sql', import.meta.url)),
  'utf8',
)
const migration = readFileSync(
  fileURLToPath(
    new URL('../../../supabase/migrations/20260730123000_project_spaces_lifecycle_and_releases.sql', import.meta.url),
  ),
  'utf8',
)
const cleanupClockMigration = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/migrations/20260730124500_thumbnail_cleanup_claim_clock_and_release.sql',
      import.meta.url,
    ),
  ),
  'utf8',
)
const edgeFunction = readFileSync(
  fileURLToPath(new URL('../../../supabase/functions/thumbnail-cleanup/index.ts', import.meta.url)),
  'utf8',
)
const edgeConfig = readFileSync(fileURLToPath(new URL('../../../supabase/config.toml', import.meta.url)), 'utf8')
const cronSchedule = readFileSync(
  fileURLToPath(new URL('../../../supabase/scripts/schedule-thumbnail-cleanup.sql', import.meta.url)),
  'utf8',
)

describe('thumbnail storage lifecycle migration', () => {
  it('persists every signed artifact and its cleanup retry state', () => {
    expect(migration).toContain('create table app.project_thumbnail_artifacts')
    expect(migration).toContain("'pending', 'current', 'cleanup_pending', 'deleted'")
    expect(migration).toContain('cleanup_attempts integer not null default 0')
    expect(migration).toContain('next_cleanup_at timestamptz')
    expect(migration).toContain('expires_at timestamptz not null')
    expect(migration).toContain('cleanup_lease_token uuid')
    expect(migration).toContain('cleanup_lease_until timestamptz')
  })

  it('retains the cleanup ledger across physical project or user deletion', () => {
    const artifactTable = migration.slice(
      migration.indexOf('create table app.project_thumbnail_artifacts'),
      migration.indexOf('create index project_thumbnail_artifacts_cleanup_idx'),
    )
    expect(artifactTable).toContain('project_id uuid references app.projects(id) on delete set null')
    expect(artifactTable).toContain('created_by uuid not null')
    expect(artifactTable).not.toContain('references auth.users')
    expect(artifactTable).toContain("check (project_id is not null or status in ('cleanup_pending', 'deleted'))")
    expect(migration).toContain('create function app.schedule_project_thumbnail_cleanup_on_delete')
    expect(migration).toContain('before delete on app.projects')
    expect(migration).toContain("artifact.status in ('pending', 'current')")
    expect(migration).toContain('next_cleanup_at = greatest(artifact.expires_at, delete_now)')
  })

  it('keeps revision and release attribution without blocking auth-user deletion', () => {
    const initialRevisions = initialMigration.slice(
      initialMigration.indexOf('create table app.project_revisions'),
      initialMigration.indexOf('create index project_revisions_project_created_idx'),
    )
    const releases = migration.slice(
      migration.indexOf('create table app.project_releases'),
      migration.indexOf('insert into app.project_releases'),
    )
    expect(initialRevisions).toContain('created_by uuid not null')
    expect(initialRevisions).not.toContain('created_by uuid not null references auth.users')
    expect(migration).toContain('drop constraint if exists project_revisions_created_by_fkey')
    expect(releases).toContain('published_by uuid not null')
    expect(releases).not.toContain('published_by uuid not null references auth.users')
  })

  it('limits artifact ledger access to project members and mutation to editors', () => {
    expect(migration).toContain('create policy thumbnail_artifacts_member_select')
    expect(migration).toContain('app.current_project_member_role(project_id) is not null')
    expect(migration).toContain('create policy thumbnail_artifacts_member_update')
    expect(migration).toContain("app.current_project_member_role(project_id) in ('owner', 'editor')")
    expect(migration).toContain('grant select, insert, update on app.project_thumbnail_artifacts')
  })

  it('lets the authenticated backend remove only owned project thumbnail paths, including trashed projects', () => {
    expect(migration).toContain('create policy easy_dashboard_thumbnail_delete')
    expect(migration).toContain('include_deleted boolean default false')
    expect(migration).toContain('create function app.can_delete_thumbnail_object')
    expect(migration).toContain("artifact.status = 'cleanup_pending'")
    expect(migration).toContain("member.role in ('owner', 'editor')")
    expect(migration).toMatch(
      /create policy easy_dashboard_thumbnail_delete[\s\S]*app\.can_delete_thumbnail_object\(name, auth\.uid\(\)\)/,
    )
    expect(migration).toMatch(
      /create policy easy_dashboard_thumbnail_insert[\s\S]*app\.can_upload_thumbnail_object\(name, auth\.uid\(\)\)/,
    )
  })

  it('allows signed uploads only for the exact live pending ledger artifact', () => {
    expect(migration).toContain('create function app.can_upload_thumbnail_object')
    expect(migration).toContain('artifact.path = object_name')
    expect(migration).toContain("artifact.status = 'pending'")
    expect(migration).toContain('artifact.created_by = target_user_id')
    expect(migration).toContain('artifact.expires_at > now()')
    expect(migration).toContain('project.deleted_at is null')
    expect(migration).toContain("member.role in ('owner', 'editor')")
  })

  it('claims only expired due artifacts with a non-overlapping database lease', () => {
    expect(migration).toContain('create function app.claim_thumbnail_cleanup')
    expect(migration).toContain("artifact.status = 'pending'")
    expect(migration).toContain('artifact.expires_at <= claim_now')
    expect(migration).toContain("artifact.status = 'cleanup_pending'")
    expect(migration).toContain('coalesce(artifact.next_cleanup_at, artifact.expires_at) <= claim_now')
    expect(migration).toContain('artifact.cleanup_lease_until <= claim_now')
    expect(migration).toContain('for update of artifact skip locked')
    expect(migration).toContain('cleanup_lease_token = claim_token')
    expect(migration).toMatch(
      /revoke all on function app\.claim_thumbnail_cleanup\(uuid, integer, integer\)[\s\S]*from public, anon, authenticated/,
    )
  })

  it('settles claims with token compare-and-set and retry backoff', () => {
    expect(migration).toContain('create function app.finish_thumbnail_cleanup')
    expect(migration).toContain('artifact.cleanup_lease_token = claim_token')
    expect(migration).toContain("status = 'deleted'")
    expect(migration).toContain('cleanup_attempts = artifact.cleanup_attempts + 1')
    expect(migration).toContain('power(2, least(artifact.cleanup_attempts, 6))')
    expect(migration).toMatch(
      /revoke all on function app\.finish_thumbnail_cleanup\(uuid, uuid, boolean, text\)[\s\S]*from public, anon, authenticated/,
    )
  })

  it('returns the database claim clock and releases only the matching token for a database-timed retry', () => {
    expect(cleanupClockMigration).toContain('create function public.claim_thumbnail_cleanup_v2')
    expect(cleanupClockMigration).toContain('clock_timestamp()')
    expect(cleanupClockMigration).toContain('database_now timestamptz')
    expect(cleanupClockMigration).toContain('create function app.release_thumbnail_cleanup')
    expect(cleanupClockMigration).toContain('artifact.cleanup_lease_token = claim_token')
    expect(cleanupClockMigration).toContain('release_now + make_interval(secs => retry_seconds)')
    expect(cleanupClockMigration).toContain('cleanup_lease_token = null')
    expect(cleanupClockMigration).toContain('cleanup_lease_until = null')
    expect(cleanupClockMigration).not.toContain("status = 'deleted'")
    expect(cleanupClockMigration).not.toContain('cleanup_attempts =')
    expect(cleanupClockMigration).not.toContain('last_error =')
  })

  it('exposes cleanup RPC only to the service role used by the Edge Function', () => {
    expect(migration).toContain('create function public.claim_thumbnail_cleanup')
    expect(migration).toContain('create function public.finish_thumbnail_cleanup')
    expect(migration).toMatch(
      /revoke all on function public\.claim_thumbnail_cleanup\(uuid, integer, integer\)[\s\S]*from public, anon, authenticated/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.claim_thumbnail_cleanup\(uuid, integer, integer\)[\s\S]*to service_role/,
    )
    expect(migration).not.toContain(
      'grant execute on function public.claim_thumbnail_cleanup(uuid, integer, integer)\n  to easy_dashboard_runtime',
    )
    expect(cleanupClockMigration).toMatch(
      /revoke all on function public\.claim_thumbnail_cleanup_v2\(uuid, integer, integer\)[\s\S]*from public, anon, authenticated/,
    )
    expect(cleanupClockMigration).toMatch(
      /revoke all on function public\.release_thumbnail_cleanup\(uuid, uuid, integer\)[\s\S]*from public, anon, authenticated/,
    )
    expect(cleanupClockMigration).toMatch(
      /grant execute on function public\.claim_thumbnail_cleanup_v2\(uuid, integer, integer\)[\s\S]*to service_role/,
    )
    expect(cleanupClockMigration).toMatch(
      /grant execute on function public\.release_thumbnail_cleanup\(uuid, uuid, integer\)[\s\S]*to service_role/,
    )
    expect(cleanupClockMigration).not.toContain('to easy_dashboard_runtime')
  })

  it('keeps service-role Storage deletion inside the secret-authenticated Edge Function', () => {
    expect(edgeConfig).toMatch(/\[functions\.thumbnail-cleanup\][\s\S]*verify_jwt = false/)
    expect(edgeFunction).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')")
    expect(edgeFunction).toContain("Deno.env.get('THUMBNAIL_CLEANUP_CRON_SECRET')")
    expect(edgeFunction).toContain("supabase.rpc('claim_thumbnail_cleanup_v2'")
    expect(edgeFunction).toContain("supabase.rpc('finish_thumbnail_cleanup'")
    expect(edgeFunction).toContain("supabase.rpc('release_thumbnail_cleanup'")
    expect(edgeFunction).toContain('storage.remove([objectPath])')
  })

  it('schedules the function with Supabase Cron, pg_net, and Vault secrets', () => {
    expect(cronSchedule).toContain('create extension if not exists pg_cron')
    expect(cronSchedule).toContain('create extension if not exists pg_net')
    expect(cronSchedule).toContain('cron.schedule(')
    expect(cronSchedule).toContain('net.http_post(')
    expect(cronSchedule).toContain('vault.decrypted_secrets')
    expect(cronSchedule).toContain('easy_dashboard_thumbnail_cleanup_cron_secret')
  })
})
