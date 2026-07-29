# EasyDashboard API

The portable Hono application lives in `src/app.ts`. `src/node.ts` is the local
Node adapter and `../api/index.ts` is the thin Vercel adapter. `vercel.json`
routes `/api/*` to that function; the Web Request keeps the original pathname
that Hono matches.

## Database roles and connections

Run the canonical migration using `MIGRATION_DATABASE_URL`, which must be a
direct or session-mode administrator connection. The migration creates the
least-privilege `easy_dashboard_runtime` login without embedding a credential
in Git.

Generate a password in your secret manager, then run the following once through
the Supabase SQL editor or an administrator `psql` session:

```sql
alter role easy_dashboard_runtime
  with login noinherit nobypassrls
  password '<replace-with-a-generated-secret>';
```

Set `DATABASE_URL` to the Supavisor transaction-mode endpoint on port `6543`
using that login. Shared-pooler usernames include the Supabase project ref:

```text
postgresql://easy_dashboard_runtime.<PROJECT_REF>:<url-encoded-password>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require
```

Do not use the transaction-mode URL for migrations. Do not use the `postgres`
or `service_role` credential as the application runtime identity. The runtime
pool is intentionally small and Drizzle queries must not use named prepared
statements.

For migrations, use either the direct database endpoint or Supavisor session
mode on port `5432`:

```text
postgresql://postgres:<url-encoded-password>@db.<PROJECT_REF>.supabase.co:5432/postgres?sslmode=require
postgresql://postgres.<PROJECT_REF>:<url-encoded-password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
```

Every private repository operation starts a transaction and sets
`app.actor_id` transaction-locally. Public reads set exactly one
`app.public_slug`; RLS permits only the matching publication, project, and
current revision.

## HTTP mutation contract

Authenticated mutations must use:

- `Content-Type: application/json`
- `Origin` exactly equal to `APP_ORIGIN`
- `Sec-Fetch-Site: same-origin` when supplied by the browser
- `X-CSRF-Token: 1`

The serialized request is capped below Vercel's platform limit. The inner
EasyEditor schema is additionally limited by byte size, nesting depth, JSON node
count, map-entry count, and individual string size.

## Response shape

Successful JSON responses use named wrappers (`{ "project": ... }`,
`{ "projects": [...] }`, `{ "revisions": [...] }`, `{ "templates": [...] }`,
and `{ "publication": ... }`). Project reads and draft writes expose the
canonical document as `project.draftSchema` and its CAS token as
`project.draftVersion`. Project-list rows additionally expose nullable
`publicationSlug` and `publishedRevisionId`.
