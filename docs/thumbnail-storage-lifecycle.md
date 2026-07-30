# Thumbnail storage lifecycle

Every signed thumbnail path is recorded in `app.project_thumbnail_artifacts`.
The state machine is:

`pending -> current -> cleanup_pending -> deleted`

A pending upload also moves directly to `cleanup_pending` when it expires, is
superseded, fails validation, or the client reports failure. Promoting a new
current artifact and scheduling the former current artifact for cleanup happen
in the same database transaction. Cleanup is never scheduled before the signed
upload expires, because a delayed upload may still arrive after the artifact
was superseded or failed.

The ledger is created before Supabase signs the upload because the Storage RLS
policy needs that exact pending row. It starts with a conservative staging
deadline. After signing finishes, Hono decodes the token expiry (falling back
to Supabase's documented two-hour lifetime), adds a safety minute, and
persists that later cleanup boundary before returning the URL. A delayed
signing request therefore cannot make the database expiry precede the real
upload token.

User-triggered cleanup is best-effort. The API can use the authenticated user's
JWT to remove an exact `cleanup_pending` object for a project they can edit;
the browser never receives a general delete capability. The delete policy lets
one owner/editor clean an artifact uploaded by another collaborator. The
insert policy is narrower: the exact path must be an unexpired `pending` ledger
entry created by the current user, and the project must still be active with
owner/editor access.

Final cleanup is independent of online users. Supabase Cron invokes the
`thumbnail-cleanup` Edge Function every five minutes through `pg_net`. The
service-to-service bearer secret is stored in both Supabase Vault and the Edge
Function secret store. JWT verification is disabled only for this function;
the function rejects every request whose bearer secret does not match.
Supabase injects `SUPABASE_SERVICE_ROLE_KEY` into the function by default, so
that elevated credential never enters Hono, Vercel, the viewer, or browser
code.

The Edge Function can call only the service-role RPC wrappers
`public.claim_thumbnail_cleanup_v2`, `public.finish_thumbnail_cleanup`, and
`public.release_thumbnail_cleanup`; all are revoked from `public`, `anon`, and
`authenticated`. Each object is claimed with a fresh random lease token. The
claim response includes the database clock used for the final expiry guard, so
Edge runtime clock skew cannot leave a valid lease stranded. The underlying
function atomically:

1. moves globally expired `pending` uploads to `cleanup_pending`;
2. clears matching stale project pending state;
3. selects only artifacts whose `expires_at` and `next_cleanup_at` are due;
4. excludes the path currently referenced by a project; and
5. claims one row with `FOR UPDATE SKIP LOCKED` and a ten-minute lease.

The worker claims each object immediately before deleting only that exact path
through Supabase Storage `remove`. It never writes to `storage.objects`
directly. Settlement compares both artifact ID and lease token. If the final
database-clock guard ever sees an anomalous not-yet-expired claim, the worker
uses a separate compare-and-set release RPC. Only the holder of that exact
claim token can clear the lease, and the database schedules a short retry from
its own `clock_timestamp()`; the release does not mark the object cleaned or
failed and does not increment cleanup attempts. A successful delete becomes
`deleted`; a failed call stays `cleanup_pending`, clears its lease, increments
`cleanup_attempts`, and receives exponential retry backoff capped at six hours.
Later objects never wait behind an earlier deletion on the same lease. An
expired lease can be claimed by another invocation, so overlapping or duplicate
Cron deliveries do not process the same live claim. Storage deletion and
settlement are idempotent if a prior invocation was interrupted between those
two operations.

The project reconcile endpoint still runs when the editor is seeded and before
a new upload. It reduces short-term garbage for active projects, while the Cron
worker is the final lifecycle guarantee for inactive and trashed projects.

Trashing a project deactivates publication, clears all thumbnail references,
and schedules every non-deleted artifact in the same transaction. Storage
reconciliation runs afterward and still observes each artifact's expiry time.

Physical project or auth-user deletion also cannot erase the cleanup ledger.
Before a project row is deleted, a security-definer trigger moves its `pending`
and `current` artifacts to `cleanup_pending`; unexpired uploads still wait for
their signed-upload expiry. The artifact's nullable project foreign key then
uses `ON DELETE SET NULL`, and `created_by` remains as a historical UUID rather
than cascading the row away. The Cron worker can therefore finish deleting the
exact Storage path after the project and user no longer exist.
