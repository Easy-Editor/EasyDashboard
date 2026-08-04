# EasyDashboard

<div align="center">

English | [简体中文](./README-zh_CN.md)

</div>

EasyDashboard is a personal workspace for building and publishing data
visualization dashboards with the
[EasyEditor](https://github.com/Easy-Editor/EasyEditor) low-code engine. The
repository contains a React editor, a Hono API, and a separate cookie-less
public viewer.

<div align="center">
  <img src=".github/assets/page.png" width="1000" alt="EasyDashboard editor" />
</div>

## Current capabilities

- Create, search, favorite, duplicate, trash, and restore projects in a
  server-provisioned personal space.
- Build multi-page dashboards with drag-and-drop editing, property
  configuration, JSON schema editing, page ordering, and a configurable start
  page.
- Save drafts to PostgreSQL with optimistic concurrency. Project documents are
  not persisted to LocalStorage.
- Create manual restore points, retain periodic automatic restore points, and
  restore a previous snapshot without deleting the existing history.
- Generate automatic project thumbnails or upload a custom thumbnail through a
  private Supabase Storage bucket and signed URLs.
- Publish the saved draft to both a stable viewer URL and a versioned URL backed
  by an immutable release snapshot.
- Sign in with email and password, GitHub, or Google. The Hono API keeps
  Supabase sessions in secure host-only cookies.
- Start private, multi-conversation Agent tasks from the home page or editor;
  attach project or conversation files, watch task stages, and keep confirmed
  project context plus private cross-project preferences.
- Execute model-produced ChangeSets through an isolated EasyEditor Host and
  headless Chromium, commit with draft-version CAS, retain receipts, and undo a
  committed Agent operation.
- Configure the platform relay or a verified OpenAI-compatible model with
  task/month budgets, versioned built-in Skills, and fail-closed MCP policy.

Templates as a product workflow, team collaboration, and 3D editing are not
part of the current application.

## Workspace

This repository is a pnpm workspace:

```text
EasyDashboard/
├── api/                     # thin Vercel Function adapter
├── server/                  # portable Hono API and Node development adapter
├── src/                     # authenticated React application and editor
├── supabase/migrations/     # ordered database and storage migrations
├── viewer/                  # separate cookie-less public viewer
└── pnpm-workspace.yaml
```

## Requirements

- Node.js 22.x (the exact CI version is recorded in `.node-version`)
- pnpm 10.28.2
- Docker for the local Supabase stack
- A separate Supabase project for each hosted environment

## Local development

1. Install the workspace dependencies:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Start the repository-pinned Supabase CLI:

   ```bash
   pnpm exec supabase start
   pnpm exec supabase status -o env \
     --override-name api.url=SUPABASE_URL,auth.publishable_key=SUPABASE_PUBLISHABLE_KEY
   ```

   A fresh local stack applies `supabase/roles.sql` and the ordered migrations.
   `roles.sql` contains a local/CI-only runtime password; hosted environments
   must provision their own strong random password. If an existing local stack
   contains development data, do not run `supabase db reset` just to update the
   role. Apply the local-only role file without deleting data:

   ```bash
   pnpm exec supabase db query --local --file supabase/roles.sql
   ```

3. Create `.env` from [`.env.example`](./.env.example). Use the local values
   reported by `supabase status` and these origins:

   ```text
   APP_ORIGIN=http://127.0.0.1:5173
   PUBLIC_VIEWER_ORIGIN=http://view.localhost:5174
   PORT=8787
   VITE_PUBLIC_VIEWER_ORIGIN=http://view.localhost:5174
   VITE_PUBLIC_API_ORIGIN=http://127.0.0.1:5173
   SUPABASE_URL=<SUPABASE_URL reported by supabase status>
   SUPABASE_PUBLISHABLE_KEY=<SUPABASE_PUBLISHABLE_KEY reported by supabase status>
   DATABASE_URL=postgresql://easy_dashboard_runtime:easy_dashboard_ci_local_only@127.0.0.1:54322/postgres
   ```

   The browser calls the API through the app's same-origin `/api` path. Vite
   proxies that path to the Hono development server on port `8787`.

4. When the sibling `EasyEditor` checkout is present, build and lock the local
   isolated Document Executor once (and repeat this after changing its runtime
   or Host artifacts):

   ```bash
   pnpm setup:agent-executor
   ```

   This creates the ignored `.env.agent.local`; it never modifies `.env.local`
   or exposes the model key to Chromium.

5. Start the four development processes:

   ```bash
   pnpm dev
   ```

Open the authenticated app at `http://127.0.0.1:5173` and the public viewer at
`http://view.localhost:5174`.

## Local verification

Install Chromium once, then run the product-lifecycle browser test:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

The test creates a uniquely named local E2E account and project, permanently
deletes the project, and does not reset developer data.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the app, viewer, API, and isolated Agent executor artifact server |
| `pnpm dev:web` | Start only the authenticated app |
| `pnpm dev:viewer` | Start only the public viewer |
| `pnpm dev:server` | Start only the Hono API |
| `pnpm dev:executor` | Serve the immutable local Agent executor browser artifact |
| `pnpm setup:agent-executor` | Build the sibling Host artifact and generate its local compatibility lock |
| `pnpm build` | Build the app, viewer, and server |
| `pnpm typecheck` | Type-check all three workspace applications |
| `pnpm test` | Run the web, public Viewer, and server test suites |
| `pnpm test:e2e` | Run the Chromium product-lifecycle test |
| `pnpm test:e2e:ui` | Open the Playwright test UI |
| `pnpm eval:agent <recording.json> [baseline.json]` | Score recorded Agent output against the fixed dashboard evaluation set |
| `pnpm lint` | Run Biome checks |
| `pnpm format` | Format the workspace with Biome |

## Architecture and deployment

- [Architecture](./docs/ARCHITECTURE.md)
- [Design contract](./DESIGN.md)
- [Product design](./docs/PRODUCT-DESIGN.md)
- [Agent V1 product and system plan](./docs/AI-AGENT-PLAN.md)
- [Agent V1 implementation plan](./.omx/plans/easy-dashboard-agent-v1.md)
- [Supabase and Vercel deployment](./docs/DEPLOYMENT.md)
- [Remote materials](./docs/remote-materials.md)

## Contributing

Contributions are welcome. Open an issue or pull request with a focused change
and its verification evidence.

## License

[MIT](./LICENSE) License &copy; 2024-PRESENT
[JinSo](https://github.com/JinSooo)
