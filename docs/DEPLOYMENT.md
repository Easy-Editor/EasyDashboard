# EasyDashboard Deployment

Each hosted environment uses one Supabase project and two Vercel Projects
created from the same Git repository. Keep the authenticated application and
public viewer on different origins.

Do not share databases or secrets between CI, staging, and production:

- CI starts a disposable local Supabase stack in Docker and removes it after
  the workflow.
- Staging uses its own Supabase project, app/API Vercel Project, viewer Vercel
  Project, domains, OAuth callbacks, and secrets.
- Production uses another isolated set of those resources.

`supabase/roles.sql` is only for local development and CI. Do not apply it to a
hosted project and do not use `supabase db push --include-roles` for staging or
production.

Examples below use:

```text
Authenticated app/API: https://app.example.com
Public viewer:         https://view.example.com
Supabase URL:          https://<PROJECT_REF>.supabase.co
```

Replace every example hostname, project ref, and credential.

## 1. Database and Storage

Create a Supabase project, then apply every migration in filename order with a
direct or Supavisor session-mode administrator connection:

```bash
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/migrations/20260729052216_initial_app_schema.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/migrations/20260730123000_project_spaces_lifecycle_and_releases.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/migrations/20260730124500_thumbnail_cleanup_claim_clock_and_release.sql
```

Run the same sequence against a disposable or staging database before applying
it to production, and take a database backup first. `ON_ERROR_STOP` together
with `--single-transaction` keeps each migration file atomic: any failed
statement rolls that file back instead of leaving a partially applied schema.

Use one of these administrator URL forms:

```text
# Direct database connection
postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres?sslmode=require

# Supavisor session mode
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
```

The migrations create:

- the private `app` schema and least-privilege runtime role;
- personal spaces, memberships, project lifecycle metadata, favorites, restore
  points, publications, and immutable releases;
- the thumbnail artifact claim/lease and retry functions used by the trusted
  cleanup worker;
- the private `easy-dashboard-thumbnails` Storage bucket;
- Storage policies for signed thumbnail upload and download.

Generate a separate strong runtime password and set it once through an
administrator connection:

```sql
alter role easy_dashboard_runtime
  with login noinherit nobypassrls
  password '<GENERATED_PASSWORD>';
```

The Hono runtime uses Supavisor transaction mode on port `6543`:

```text
postgresql://easy_dashboard_runtime.<PROJECT_REF>:<GENERATED_PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require
```

Do not use the transaction-mode URL for migrations. Do not use the `postgres`
password or a Supabase service credential as the Hono database identity. The
normal repository remains connected as `easy_dashboard_runtime`.

## 2. Thumbnail cleanup Edge Function and Cron

The final Storage cleanup worker runs inside Supabase, not Hono or Vercel.
Deploy it after applying the migration:

```bash
supabase functions deploy thumbnail-cleanup --no-verify-jwt
```

`supabase/config.toml` records the same function-level `verify_jwt = false`
setting. The endpoint therefore requires its own high-entropy service-to-service
secret. Generate one, then set the identical value in the Edge Function secret
store and Supabase Vault:

```bash
THUMBNAIL_CLEANUP_CRON_SECRET="$(openssl rand -hex 32)"
supabase secrets set \
  THUMBNAIL_CLEANUP_CRON_SECRET="$THUMBNAIL_CLEANUP_CRON_SECRET"
```

```sql
select vault.create_secret(
  'https://<PROJECT_REF>.supabase.co',
  'easy_dashboard_project_url'
);
select vault.create_secret(
  '<THUMBNAIL_CLEANUP_CRON_SECRET>',
  'easy_dashboard_thumbnail_cleanup_cron_secret'
);
```

Do not print, commit, or reuse this value. Apply the idempotent schedule only
after both Vault values and the deployed Function exist:

```bash
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/scripts/schedule-thumbnail-cleanup.sql
```

The schedule uses `pg_cron` + `pg_net` every five minutes. The Edge Function
receives `SUPABASE_SERVICE_ROLE_KEY` from Supabase's default Function
environment and uses it only for exact-path Storage `remove` plus the three
cleanup RPCs. Those public RPC wrappers are granted only to `service_role` and
delegate to the private `app` claim/finish/release functions. Each object is
claimed immediately before deletion with `FOR UPDATE SKIP LOCKED`, its own
ten-minute lease token, and a database-clock expiry check; settlement and the
defensive short-delay release both use artifact-ID + lease-token
compare-and-set.

Neither `SUPABASE_SERVICE_ROLE_KEY` nor the Cron secret belongs in Vercel.
Hono remains connected as `easy_dashboard_runtime` and never receives an
elevated Supabase API credential.

## 3. Authentication

### Supabase URL configuration

In Supabase Auth URL Configuration:

- Set the Site URL to `https://app.example.com`.
- Add `https://app.example.com/api/auth/oauth/callback**` to Redirect URLs. The
  scoped glob is required because the server adds a random `state` query
  parameter.
- Add `https://app.example.com/api/auth/password/callback` to Redirect URLs for
  password recovery.

Add these entries when testing the local application:

```text
http://127.0.0.1:5173/api/auth/oauth/callback**
http://127.0.0.1:5173/api/auth/password/callback
```

Do not use a broad production-domain wildcard.

These values match the `redirectTo` URLs created by `server/src/routes/auth.ts`.
Supabase documents the allow-list requirement in its
[Redirect URLs guide](https://supabase.com/docs/guides/auth/redirect-urls).

Password recovery remains stateless across Vercel Function instances. The
callback keeps Supabase's short-lived, single-use PKCE authorization code and
its verifier in `Secure`, `HttpOnly`, `SameSite=Lax`, Host-only cookies for ten
minutes. The final password mutation exchanges that code and immediately
clears both cookies. No recovery session or bearer token is stored in
process-local memory, browser storage, or a URL.

### GitHub provider

1. Create a GitHub OAuth App.
2. Set its Homepage URL to `https://app.example.com`.
3. Set its Authorization callback URL to the Supabase callback:

   ```text
   https://<PROJECT_REF>.supabase.co/auth/v1/callback
   ```

4. Enable GitHub in Supabase Auth Providers and enter the OAuth App client ID
   and secret.

The provider callback points to Supabase, not directly to the Hono callback.
Supabase then redirects the PKCE flow to the allow-listed Hono URL. See
[Supabase Login with GitHub](https://supabase.com/docs/guides/auth/social-login/auth-github).

### Google provider

1. Create a Google OAuth client with application type **Web application**.
2. Add `https://app.example.com` as an Authorized JavaScript origin.
3. Add the Supabase callback as an Authorized redirect URI:

   ```text
   https://<PROJECT_REF>.supabase.co/auth/v1/callback
   ```

4. Enable Google in Supabase Auth Providers and enter the client ID and secret.

See
[Supabase Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
for the provider-side setup and required scopes.

## 4. Vercel Project: authenticated app and API

Create the first Vercel Project with:

| Setting | Value |
| --- | --- |
| Root Directory | `.` |
| Framework Preset | Vite |
| Build Command | `pnpm build:web && pnpm build:server` |
| Output Directory | `dist` |
| Function region | `sin1` from the root `vercel.json` |

Configure these environment variables:

```text
APP_ORIGIN=https://app.example.com
PUBLIC_VIEWER_ORIGIN=https://view.example.com
VITE_PUBLIC_VIEWER_ORIGIN=https://view.example.com
ENABLE_EXPERIMENTAL_COREPACK=1
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<SUPABASE_PUBLISHABLE_KEY>
DATABASE_URL=postgresql://easy_dashboard_runtime.<PROJECT_REF>:<PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require
```

`APP_ORIGIN` is an exact security boundary for private requests and
authenticated mutations. A preview deployment therefore needs its own exact
origin and matching Supabase redirect entries, or a stable preview hostname
configured in advance.

The root project serves the Vite application and `/api/*` Hono routes from the
same origin.

## 5. Vercel Project: public viewer

Create a second Vercel Project from the same repository:

| Setting | Value |
| --- | --- |
| Root Directory | `viewer` |
| Framework Preset | Vite |
| Build Command | `pnpm build` |
| Output Directory | `dist` |

Keep source-outside-root access enabled because the viewer workspace imports
renderer code and assets from the repository root. `viewer/middleware.ts`
validates `/view/*` before `viewer/vercel.json` applies the static
`index.html` fallback.

Configure only these build variables:

```text
VITE_PUBLIC_VIEWER_ORIGIN=https://view.example.com
VITE_PUBLIC_API_ORIGIN=https://app.example.com
ENABLE_EXPERIMENTAL_COREPACK=1
```

`VITE_PUBLIC_VIEWER_ORIGIN` is the viewer's own origin.
`VITE_PUBLIC_API_ORIGIN` points to the authenticated app/API origin and is used
by both the browser bundle and the Viewer Routing Middleware before the static
SPA fallback. Unavailable stable and immutable routes therefore return an
actual HTTP `404`; upstream validation failures return `503` instead of a false
not-found response.
Corepack makes Vercel use the repository's pinned pnpm version.

Never configure `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`THUMBNAIL_CLEANUP_CRON_SECRET`, or another private credential in the viewer
project. Viewer requests use
`credentials: 'omit'`.

## 6. Release verification

Before promoting a deployment:

1. Run `pnpm install --frozen-lockfile`.
2. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and
   `pnpm test:e2e` against an isolated local or staging Supabase environment.
3. Confirm `/api/health/live` returns `{"status":"ok"}` and
   `/api/health/ready` returns `{"status":"ready"}`.
4. Confirm email/password, GitHub, Google, sign-out, and password recovery work
   on the production app origin.
5. Confirm the app creates a personal space on the first authenticated flow and
   can create and save a multi-page project.
6. Confirm thumbnail upload finishes through a signed URL and that the bucket
   is private.
7. Publish twice and confirm:
   - `/view/<slug>` renders the latest release;
   - `/view/<slug>/versions/1` still renders release 1;
   - the viewer API requests target the app origin and send no cookies.
8. Unpublish the project. Confirm the stable URL and every version URL
   themselves return HTTP `404`, while their API probes return
   `404 PUBLICATION_NOT_FOUND`.
9. Publish again, move the project to the trash, and repeat the same `404`
   checks. Restoring the project must not make either URL public until it is
   published again.
10. Confirm the Supabase Edge Function returns `401` without the Cron bearer
    secret. With the secret, confirm an expired `cleanup_pending` artifact is
    deleted, a not-yet-expired signed-upload path is retained, and a simulated
    Storage failure leaves the row scheduled for retry.
11. Confirm the viewer deployment contains none of the private variables listed
    above.
