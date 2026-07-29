# EasyDashboard V1 Architecture

## Outcome

EasyDashboard V1 is a personal dashboard workspace with authentication, project
management, autosaved drafts, immutable revisions, publishing, and an isolated
public viewer. Agent execution is deliberately outside the V1 runtime.

## Deployment topology

| Concern | V1 decision |
| --- | --- |
| Web application | React/Vite static application on Vercel |
| API | Hono on Vercel Node Functions |
| Function region | Singapore (`sin1`) |
| Database | Supabase managed PostgreSQL in Singapore |
| Authentication | Supabase Auth, owned by Hono through secure cookies |
| Object storage | Supabase Storage with browser-to-storage transfers |
| Public viewer | Separate cookie-less Vercel project and origin |
| Future Agent worker | Separate durable worker runtime, initially eligible for Alibaba Cloud |

The authenticated web application and Hono API share one browser origin. The
public viewer must not share the authenticated application origin because a
dashboard schema may execute expressions, lifecycle code, and remote materials.
They are deployed as two Vercel Projects from the same repository: the
authenticated app plus API uses repository root `.`, while the public viewer
uses root directory `viewer`. The viewer build contains no Supabase key,
database URL, auth cookie handling, or private API route.
It also forces `credentials: 'omit'` for JavaScript fetches; the separate
origin remains the primary boundary for any executable published content.

## Repository boundary

The existing web application remains at the repository root. V1 adds two
workspace packages:

```text
EasyDashboard/
├── api/                     # thin Vercel Function adapter
├── server/                  # portable Hono application
│   ├── src/
│   │   ├── auth/
│   │   ├── db/
│   │   ├── middleware/
│   │   ├── routes/
│   │   └── services/
│   └── package.json
├── src/                     # existing React application and editor
├── supabase/migrations/     # canonical SQL migrations
├── viewer/                  # cookie-less public viewer Vercel project
└── pnpm-workspace.yaml
```

`server/src/app.ts` contains the portable Hono application. Vercel and local
Node entrypoints are adapters only. Agent packages, routes, tables, prompts,
model keys, and worker code are excluded from this branch.

## Runtime invariants

### Project schema

- A complete EasyEditor `ProjectSchema` is the atomic draft document.
- Draft and revision snapshots are stored as PostgreSQL `jsonb`.
- The serialized schema must not exceed 3.5 MiB.
- The server also enforces structural budgets for nesting, node count, map
  entries, and individual strings.
- Assets and attachments never travel through Hono; they use signed Supabase
  Storage uploads and downloads.

### Concurrency

- Every draft has a monotonically increasing `draft_version`.
- Draft writes use compare-and-swap with `expectedVersion`.
- A stale write returns `409 DRAFT_CONFLICT`.
- The browser permits one save request in flight and coalesces later edits.
- Publish requires the expected saved draft version.

### Publishing

- Publishing reads the canonical stored draft; it never trusts a second schema
  supplied by the client.
- One database transaction verifies ownership and version, inserts an immutable
  revision, and moves the stable publication pointer.
- Rollback moves the publication pointer to an existing revision.
- Unpublish clears the pointer.
- Revision rows cannot be updated by the runtime role.

### Authentication and request security

- Supabase access and refresh tokens are stored only in host-only `__Host-`
  cookies with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`.
- Browser storage never contains authentication tokens.
- Hono owns sign-up, sign-in, session refresh, and sign-out.
- Auth responses use `Cache-Control: private, no-store`.
- Mutations require JSON, an exact configured `Origin`, same-origin fetch
  metadata, and a custom CSRF header.
- Refresh attempts are coalesced only inside the same warm Vercel Function
  instance. Requests that reach different instances rely on Supabase's refresh
  token reuse and parent-token semantics; V1 does not claim a cross-instance
  single-flight guarantee.

### Database access

- Vercel runtime connections use Supavisor transaction mode on port `6543`.
- Named or prepared statements are prohibited on the runtime connection.
- Migration commands use a separate direct or session-mode connection.
- Runtime queries use a small module-scoped pool.
- Every private operation runs inside one checked-out transaction, sets the
  verified actor transaction-locally, and scopes queries by owner.
- Application tables live in a non-exposed `app` schema.
- The runtime database role is non-owner and `NOBYPASSRLS`; RLS is a backstop,
  not a replacement for explicit ownership predicates.

## V1 data model

| Table | Responsibility |
| --- | --- |
| `app.projects` | owner, name, current draft, draft version, timestamps |
| `app.project_revisions` | append-only immutable schema snapshots |
| `app.project_publications` | stable slug pointing to one revision |
| `app.templates` | read-only official project templates |
| `app.user_settings` | settings that are actually exposed in V1 |

Business tables are not exposed through Supabase Data API. All business data
flows through Hono.

## API surface

```text
GET    /api/health/live
GET    /api/health/ready

POST   /api/auth/sign-up
POST   /api/auth/sign-in
POST   /api/auth/sign-out
GET    /api/auth/session

GET    /api/projects
POST   /api/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
PUT    /api/projects/:projectId/draft
GET    /api/projects/:projectId/revisions
POST   /api/projects/:projectId/publish
POST   /api/projects/:projectId/rollback
POST   /api/projects/:projectId/unpublish

GET    /api/templates
GET    /api/settings
PATCH  /api/settings
GET    /api/public/projects/:slug
```

Public lookup returns only the currently published revision and safe rendering
metadata. It never returns drafts, owner metadata, revision history, or arbitrary
revision IDs.

## Release gates

- Fresh workspace install with a frozen lockfile.
- Web and server lint, typecheck, tests, and production builds pass.
- Empty-database migration succeeds.
- Cross-user access tests prove owner isolation.
- Concurrent draft writes produce a deterministic conflict.
- Injected publish failures leave no revision or pointer half-committed.
- Login refresh races do not overwrite a newer cookie pair.
- Project schema localStorage persistence is absent from production V1 paths.
- Public viewer receives no authenticated application cookie.
- `EasyDashboardBackend/` is untouched.
- Agent runtime dependencies are absent from the V1 production dependency graph.

The concrete environment and deployment checklist is documented in
[`V1-DEPLOYMENT.md`](./V1-DEPLOYMENT.md).
