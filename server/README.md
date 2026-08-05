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
or Supabase service credential as the database runtime identity. The runtime
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

## M0 isolated Agent executor

For the standard sibling-checkout layout, run `pnpm setup:agent-executor` from
the repository root. It rebuilds the immutable browser artifact, computes the
exact compatibility tuple, generates a local grant secret, and writes the
ignored `.env.agent.local`. `pnpm dev` then serves that artifact on loopback and
loads the generated server configuration automatically.

Set both `AGENT_EXECUTOR_GRANT_SECRET` and
`AGENT_EXECUTOR_COMPATIBILITY_JSON` to enable the M0 Document Executor routes.
The secret must contain at least 32 random bytes. The compatibility value must
be strict JSON containing the exact release-produced artifact lock:

```json
{
  "runtimeVersion": "<version>",
  "runtimeSha256": "<64 lowercase hex characters>",
  "coreVersion": "<version>",
  "coreSha256": "<64 lowercase hex characters>",
  "rendererVersion": "<version>",
  "rendererSha256": "<64 lowercase hex characters>",
  "dashboardAgentHostVersion": "<version>",
  "dashboardAgentHostSha256": "<64 lowercase hex characters>",
  "browserArtifactVersion": "<version>",
  "browserArtifactSha256": "<64 lowercase hex characters>",
  "materialManifestVersion": "<version>",
  "materialManifestSha256": "<64 lowercase hex characters>"
}
```

Deployment tooling must source this tuple from the packaged release manifest;
do not hand-copy the current workspace's hashes. The browser artifact digest
binds the complete static Harness output that Chromium is allowed to load; the
executor verifies the loopback server's response bytes against that artifact
before launching Chromium. Invalid JSON or an incomplete or extended tuple
prevents server startup. If either setting is absent, every spike endpoint
fails closed with `503 AGENT_SPIKE_UNAVAILABLE`.

An authenticated editor issues an operation through:

```text
POST /api/projects/:projectId/agent-spike/operations
```

The Hono server first requires the requested tuple's canonical SHA-256 to equal
the deployment lock. It then reads the canonical draft and version, persists
the exact executor input, and returns two signed grants to the Node runner:

- `grant` is five-minute mutation authority for input, prepare, commit, and
  outcome requests.
- `recoveryGrant` is 24-hour, exact `outcome:read` authority for recovering the
  durable outcome after the mutation grant expires or a commit acknowledgement
  is lost. It is rejected by input, prepare, and commit routes.

The recovery JTI and time window are deterministically reconstructed from the
persisted operation id, creation time, and input digest. They cannot be supplied
by the client and are domain-separated from the mutation JTI. The runner keeps
both bearer grants out of Chromium and uses them for:

```text
GET  /api/agent-spike/operations/:operationId/input
PUT  /api/agent-spike/operations/:operationId/prepared
POST /api/agent-spike/operations/:operationId/commit
GET  /api/agent-spike/operations/:operationId/outcome
```

Each route checks its own grant scope and the persisted actor, project, task,
stage, executor, operation, base version, input digest, compatibility digest,
grant id, and expiry. Mutating runner requests still follow the normal
same-origin JSON and `X-CSRF-Token: 1` contract. Preparing validates the full
Host result and the normal project Schema budgets before persisting a
candidate. Commit accepts only the operation URL and candidate SHA-256; the
repository performs the draft CAS and durable operation outcome in one
transaction.

Rendered PNG evidence has a separate authenticated artifact lifecycle:

```text
POST /api/projects/:projectId/agent-spike/operations/:operationId/screenshot-artifact/upload
POST /api/projects/:projectId/agent-spike/operations/:operationId/screenshot-artifact/complete
GET  /api/projects/:projectId/agent-spike/operations/:operationId/screenshot-artifact
```

The reservation is bound to the operation, candidate SHA-256, draft version,
declared byte size, and screenshot SHA-256. Completion downloads the private
object and verifies its PNG signature, size, content type, and digest before it
becomes readable. These routes require the authenticated project session; the
Document Executor grant is intentionally not a Supabase Storage credential.
For durable execution, configure `SUPABASE_SECRET_KEY` only on the trusted Node
worker. The parent runner gives the child a private one-use temporary path,
verifies the returned PNG bytes against the prepared screenshot digest, and
persists them through the server-only Storage client. The secret is never sent
to Chromium, the Executor child process, or a browser response.

The real PostgreSQL M0 integration test is opt-in. Set
`AGENT_SPIKE_TEST_DATABASE_URL` to an isolated runtime-test database and
`AGENT_SPIKE_TEST_ADMIN_DATABASE_URL` to its migration/admin connection before
running the server tests. Without both values, the destructive fixture setup is
skipped; never point either variable at production data.

## Durable Agent dispatch

The local Node server (`pnpm --dir server dev` or `pnpm --dir server start`)
starts the dispatcher in the same long-running process when the Agent executor
is configured. On `SIGINT` or `SIGTERM`, it stops accepting HTTP traffic, stops
the dispatcher, and waits for shutdown to finish.

The serverless/Vercel adapter only enqueues durable dispatch records; it does
not start an in-process poller. A production serverless deployment must also
run a separate long-lived worker instance:

```bash
pnpm --dir server start:worker
```

The API deployment and worker must use the same `DATABASE_URL` and the same
applicable `AGENT_EXECUTOR_*` settings. The worker also requires
`SUPABASE_SECRET_KEY` when durable screenshot artifacts are enabled. Send the
worker `SIGINT` or `SIGTERM`
for graceful shutdown; it stops polling, aborts in-flight executor work, and
waits for the dispatcher to settle before exiting. A Vercel Function alone can
enqueue Agent work, but cannot execute it.

## Response shape

Successful JSON responses use named wrappers (`{ "project": ... }`,
`{ "projects": [...] }`, `{ "revisions": [...] }`, `{ "templates": [...] }`,
and `{ "publication": ... }`). Project reads and draft writes expose the
canonical document as `project.draftSchema` and its CAS token as
`project.draftVersion`. Project-list rows additionally expose nullable
`publicationSlug` and `publishedRevisionId`.
