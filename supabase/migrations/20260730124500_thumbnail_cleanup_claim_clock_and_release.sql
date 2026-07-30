create function public.claim_thumbnail_cleanup_v2(
  claim_token uuid,
  claim_limit integer default 50,
  lease_seconds integer default 120
)
returns table (
  artifact_id uuid,
  object_path text,
  signed_upload_expires_at timestamptz,
  database_now timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    claimed.artifact_id,
    claimed.object_path,
    claimed.signed_upload_expires_at,
    clock_timestamp()
  from app.claim_thumbnail_cleanup(claim_token, claim_limit, lease_seconds) claimed
$$;

create function app.release_thumbnail_cleanup(
  target_artifact_id uuid,
  claim_token uuid,
  retry_seconds integer default 30
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  release_now timestamptz := clock_timestamp();
  updated_artifact_id uuid;
begin
  if target_artifact_id is null or claim_token is null then
    raise exception 'artifact id and claim token are required' using errcode = '22023';
  end if;
  if retry_seconds < 1 or retry_seconds > 300 then
    raise exception 'retry seconds must be between 1 and 300' using errcode = '22023';
  end if;

  update app.project_thumbnail_artifacts artifact
  set
    next_cleanup_at = greatest(
      artifact.expires_at,
      release_now + make_interval(secs => retry_seconds)
    ),
    cleanup_lease_token = null,
    cleanup_lease_until = null,
    updated_at = release_now
  where artifact.id = target_artifact_id
    and artifact.status = 'cleanup_pending'
    and artifact.cleanup_lease_token = claim_token
  returning artifact.id into updated_artifact_id;

  if updated_artifact_id is not null then
    return 'released';
  end if;
  return 'stale';
end
$$;

revoke all on function app.release_thumbnail_cleanup(uuid, uuid, integer)
  from public, anon, authenticated, easy_dashboard_runtime, service_role;

create function public.release_thumbnail_cleanup(
  target_artifact_id uuid,
  claim_token uuid,
  retry_seconds integer default 30
)
returns text
language sql
security definer
set search_path = ''
as $$
  select app.release_thumbnail_cleanup(
    target_artifact_id,
    claim_token,
    retry_seconds
  )
$$;

revoke all on function public.claim_thumbnail_cleanup_v2(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.release_thumbnail_cleanup(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_thumbnail_cleanup_v2(uuid, integer, integer)
  to service_role;
grant execute on function public.release_thumbnail_cleanup(uuid, uuid, integer)
  to service_role;
