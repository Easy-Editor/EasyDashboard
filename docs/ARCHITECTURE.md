# EasyDashboard Architecture

> This document describes the currently implemented architecture. The delivered
> Agent V1 authoring baseline and its remaining hardening contract are documented
> in [`AI-AGENT-PLAN.md`](./AI-AGENT-PLAN.md) and sequenced in
> [`.omx/plans/easy-dashboard-agent-v1.md`](../.omx/plans/easy-dashboard-agent-v1.md).

## Outcome

EasyDashboard is a personal dashboard workspace with Supabase authentication,
Agent-first project creation, private project conversations, server-executed
Agent draft changes, multi-page editing, restore points, releases, and an
isolated public viewer.

The current application does not include a template product flow, real-time team
collaboration, open MCP configuration, multi-Agent orchestration, Agent-controlled
publishing, or 3D editing. The database contains groundwork for spaces and
templates, but no current UI or route set makes those deferred capabilities a
supported product workflow.

## Deployment topology

| Concern | Current decision |
| --- | --- |
| Authenticated application | React 19/Vite static application |
| API | Portable Hono application deployed as a Vercel Node Function |
| Function region | Singapore (`sin1`) |
| Database | Supabase managed PostgreSQL |
| Authentication | Supabase Auth controlled by Hono through secure cookies |
| Thumbnail storage | Private Supabase Storage bucket with signed transfers |
| Thumbnail cleanup | Supabase Cron invokes a service-role-only Edge Function |
| Public viewer | Separate React/Vite deployment and origin |

The authenticated application and Hono API share one browser origin. The public
viewer uses a second Vercel Project and origin because a published dashboard can
contain expressions, lifecycle code, and remotely loaded materials.

The viewer build contains no database URL, Supabase key, authentication cookie
handling, or private project route. Public fetches use `credentials: 'omit'`.
The separate origin remains the primary isolation boundary.

## pnpm workspace

```text
EasyDashboard/
├── api/                     # thin Vercel Function adapter
├── server/
│   └── src/
│       ├── auth/            # Supabase PKCE and cookie integration
│       ├── db/              # Drizzle schema and repository
│       ├── middleware/      # authentication and request security
│       └── routes/          # auth, project, public, settings routes
├── src/                     # authenticated React application and editor
├── supabase/migrations/     # canonical ordered SQL migrations
├── viewer/                  # cookie-less public viewer
└── pnpm-workspace.yaml
```

The root, `server`, and `viewer` packages are pnpm workspace members.
`server/src/app.ts` contains the portable Hono application.
`server/src/node.ts` and `api/index.ts` are environment adapters.

## Agent authoring runtime

The implemented Agent path preserves the project document as the only editable
artifact:

- `/api/agent/starts` atomically creates the project, first private conversation,
  and first task;
- private conversations and task presentation state are stored per actor and
  project through a CAS workspace record;
- personal pending context remains private, while confirmed Project Context uses
  project-scoped CAS routes with revisioned edit, rollback, and delete;
- project and conversation attachments use signed storage transfers; ready assets
  can contribute extracted text and bounded image inputs to the model;
- each run resolves an explicit server-side model profile, reserves budget,
  requests a structured ChangeSet, validates it, and issues a scoped grant to the
  external document executor;
- operation outcomes, receipts, cost ranges, Skill provenance, recovery polling,
  stale-draft rejection, and undo are persisted or surfaced through authenticated
  project routes.

The product-facing Agent contract is natural-language-first. Editor turns may
carry a bounded selection context containing the current page, visible selected
component names, and canvas dimensions. That context is frozen with the provider
input and used before title, region, and recent-conversation inference; raw node
IDs, field IDs, coordinates, component names, JSON, and ChangeSet details remain
inside the execution boundary. User-visible questions, plans, and summaries are
validated fail-closed when they expose those implementation details.

For common edits to existing objects, the provider returns a semantic decision
such as replacing the selected title, changing its typography, configuring a
ranking list, or enabling a real-time clock. The server resolves that decision
against the frozen selection or a visible title, then compiles it atomically into
the existing strict ChangeSet before authorization and execution. Missing, stale,
or ambiguous targets become natural user questions. Complex creation, layout,
chart data, interaction, and custom effects continue through the compatible
low-level operation path; both paths converge on the same validator, executor,
durable checkpoint, and undo boundary.

Every turn has four always-available core capability groups: reference and
attachment understanding, semantic target editing, editable material composition,
and interaction/motion. Skills are reserved for lower-frequency specialist work
such as external data-source integration, GIS/3D, sandboxed custom components,
publishing, and specialized data cleaning. A Skill may narrow instructions and
declare required capabilities, but it cannot expand the run's granted authority.

Successful assistant summaries are recovered from the durable decision checkpoint.
When a project conversation is reopened, the client reconciles every terminal task
that is missing its assistant message, so the workspace transcript is a replayable
projection rather than a browser-lifetime side effect.

The runtime fails closed when the model, encryption material, executor artifact
lock, cost ledger, or required storage capability is unavailable. It does not
fall back to the legacy browser-side AI chat.

## Authentication and request security

- Email/password, GitHub OAuth, Google OAuth, password recovery, and sign-out
  flow through Hono.
- OAuth and password recovery use PKCE. OAuth state, verifiers, and the
  short-lived single-use recovery code are stored in ten-minute Host-only
  cookies, not browser storage.
- The password callback does not create process-local recovery state. The
  password mutation exchanges the code and verifier with Supabase and clears
  both cookies, so callback and mutation may run on different Vercel instances.
- Supabase access and refresh tokens use `Secure`, `HttpOnly`, `SameSite=Lax`,
  `Path=/` Host-only cookies.
- Authenticated responses use `Cache-Control: private, no-store`.
- Mutations require JSON, an exact `APP_ORIGIN`, same-origin fetch metadata when
  supplied, and `X-CSRF-Token: 1`.
- Every authentication flow that establishes a session ensures that the user
  has one personal space and an owner membership.
- Refresh coalescing is process-local. Requests reaching different serverless
  instances rely on Supabase refresh-token semantics.

## Project documents and draft saves

The editor persists one complete dashboard document as PostgreSQL `jsonb`. The
document envelope includes the EasyEditor schema plus presentation metadata such
as the start page and dashboard theme.

- Multi-page operations update one project document; the server derives page
  count, start page, and canvas size from that document.
- Every draft has a monotonically increasing `draft_version`.
- Draft writes compare `expectedVersion` with the stored version.
- A stale write returns `409 DRAFT_CONFLICT`.
- The browser keeps one save request in flight and coalesces later edits.
- Project documents are not stored in LocalStorage. LocalStorage is used only
  for non-document preferences such as theme and project grid/list view.
- The server rejects oversized or structurally excessive schemas.

## Restore points

`app.project_revisions` stores immutable document snapshots. A revision has one
of four kinds:

| Kind | Meaning |
| --- | --- |
| `auto` | Periodic restore point created during draft saves |
| `manual` | User-created restore point |
| `pre_restore` | Snapshot created immediately before restoring an older revision |
| `publish` | Snapshot used by a release |

Restoring a revision replaces the current draft through the same optimistic
concurrency contract. It does not update or delete existing revision rows.

## Releases and public URLs

Publishing is one database transaction:

1. Lock and verify the active project and expected draft version.
2. Insert an immutable `publish` revision.
3. Insert an immutable release with the next project-scoped release number.
4. Create or move the stable publication pointer and mark it published.

The viewer exposes two URL forms:

| URL | Contract |
| --- | --- |
| `/view/:slug` | Stable URL that resolves the current publication pointer |
| `/view/:slug/versions/:releaseNumber` | Versioned URL whose release content never changes |

The versioned content is immutable, but visibility is revocable. Both public API
responses use `Cache-Control: public, max-age=0, must-revalidate`.

Unpublishing a project or moving it to the trash disables the publication.
After either action, the public API probe returns
`404 PUBLICATION_NOT_FOUND`. Viewer Routing Middleware runs before the static
SPA fallback, so the stable URL and every versioned URL also return a real HTTP
`404`. Restoring a trashed project does not publish it again; the user must
publish explicitly.

## Thumbnail pipeline

The migration creates the private `easy-dashboard-thumbnails` bucket with a
10 MiB object limit and `image/webp`/`image/svg+xml` MIME allow list.

1. The authenticated browser requests an upload contract from Hono.
2. Hono checks project edit access and the current draft version, records a
   conservative staging deadline, then requests a signed upload URL from
   Supabase Storage.
3. After signing, Hono persists the token expiry plus a safety margin before
   returning the URL.
4. The browser uploads directly to Storage.
5. Hono validates the uploaded object metadata before committing its path.
6. Private thumbnail reads redirect to a signed download URL valid for 60
   seconds.
7. User-triggered reconciliation removes due artifacts as a latency
   optimization; it is not the lifecycle guarantee.
8. Supabase Cron invokes a bearer-secret-protected Edge Function every five
   minutes. The function claims expired artifacts through a service-role-only
   RPC, removes each exact Storage path, and settles the claim as deleted or
   retry-pending.

Storage RLS requires the first path segment to match the authenticated user and
the second to identify a project the user can access. Automatic thumbnails can
be renderer WebP or blueprint SVG; custom thumbnails are WebP. A completion for
an outdated draft version is rejected.

The final cleanup path does not depend on an online user's JWT. Each object is
claimed immediately before deletion with `FOR UPDATE SKIP LOCKED`, its own
random ten-minute lease token, and both upload-expiry and retry due-time
checks. The claim also returns the database clock used by the final Storage
guard, avoiding Edge-runtime clock skew. Settlement compares the artifact ID
and lease token, so overlapping Cron deliveries cannot settle another
invocation's claim. An anomalous not-yet-expired claim is released only by its
current token and receives a short database-timed retry without becoming
cleaned or failed. Storage failures receive bounded exponential backoff. The
Supabase service-role key exists only inside the Edge Function; Hono and both
browser bundles never receive it.

## Data model

The migrations must run in filename order.

| Table | Responsibility |
| --- | --- |
| `app.spaces` | Personal-space identity; the schema also reserves a deferred `team` kind |
| `app.space_members` | Space membership and owner/editor/viewer role |
| `app.projects` | Current draft, lifecycle state, page metadata, and thumbnail state |
| `app.project_favorites` | Per-user project favorites |
| `app.project_thumbnail_artifacts` | Signed-upload ledger, current-object state, cleanup leases, and retry schedule; survives project/user deletion |
| `app.project_revisions` | Immutable restore and publish snapshots |
| `app.project_releases` | Immutable numbered releases |
| `app.project_publications` | Stable slug, current revision pointer, and published flag |
| `app.user_settings` | User settings exposed by the current API |

Business tables live in the non-exposed `app` schema. The Hono runtime uses a
non-owner, `NOBYPASSRLS` database role. Every private repository operation uses
one checked-out transaction, sets the verified actor transaction-locally, and
also applies explicit membership predicates.

The initial migration still defines `app.templates` and the server retains a
read-only template endpoint. No template catalog or template-based creation
flow is documented as a current user capability.

## API surface

```text
GET    /api/health/live
GET    /api/health/ready

POST   /api/auth/sign-up
POST   /api/auth/sign-in
POST   /api/auth/sign-out
GET    /api/auth/oauth/:provider
GET    /api/auth/oauth/callback
POST   /api/auth/forgot-password
GET    /api/auth/password/callback
POST   /api/auth/reset-password
GET    /api/auth/session

GET    /api/projects?view=active|trash
POST   /api/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
PUT    /api/projects/:projectId/favorite
DELETE /api/projects/:projectId/favorite
POST   /api/projects/:projectId/duplicate
DELETE /api/projects/:projectId
DELETE /api/projects/:projectId/permanent
POST   /api/projects/:projectId/restore
PUT    /api/projects/:projectId/draft

GET    /api/projects/:projectId/restore-points
POST   /api/projects/:projectId/restore-points
POST   /api/projects/:projectId/restore-points/:revisionId/restore
GET    /api/projects/:projectId/releases
POST   /api/projects/:projectId/releases/:releaseNumber/restore
POST   /api/projects/:projectId/publish
POST   /api/projects/:projectId/unpublish

POST   /api/projects/:projectId/thumbnail/upload
POST   /api/projects/:projectId/thumbnail/complete
POST   /api/projects/:projectId/thumbnail/fail
POST   /api/projects/:projectId/thumbnail/reconcile
GET    /api/projects/:projectId/thumbnail/content

GET    /api/public/projects/:slug
GET    /api/public/projects/:slug/versions/:releaseNumber
GET    /api/settings
PATCH  /api/settings
```

Public project payloads contain rendering metadata and the published document.
They do not contain the current draft, project membership, thumbnail storage
paths, or restore history.

The scheduled thumbnail worker is intentionally outside the Hono API surface:
`POST <SUPABASE_URL>/functions/v1/thumbnail-cleanup`. It accepts only the Cron
bearer secret and uses RPCs granted exclusively to `service_role`.

Deployment steps and callback values are documented in
[`DEPLOYMENT.md`](./DEPLOYMENT.md).
