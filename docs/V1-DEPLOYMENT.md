# EasyDashboard V1 Deployment

V1 uses one Supabase project and two Vercel Projects created from the same Git
repository. Keep the authenticated application and the public viewer on
different origins.

## 1. Supabase

Create the Supabase project in Singapore. Apply
`supabase/migrations/20260729052216_initial_app_schema.sql` with an administrator
connection using either:

```text
# Direct database connection (use when the deployment host supports it)
postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres?sslmode=require

# Supavisor session mode
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
```

The migration creates `easy_dashboard_runtime` without storing its password in
Git. Generate a separate strong password and set it once with an administrator
connection:

```sql
alter role easy_dashboard_runtime password '<GENERATED_PASSWORD>';
```

The Hono runtime uses Supavisor transaction mode on port `6543`:

```text
postgresql://easy_dashboard_runtime.<PROJECT_REF>:<GENERATED_PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require
```

Do not use the transaction-mode URL for migrations. Do not give the Hono
runtime the `postgres` password or a Supabase `service_role` key.

## 2. Vercel Project: authenticated app and API

Create the first Vercel Project with these settings:

| Setting | Value |
| --- | --- |
| Root Directory | `.` |
| Framework Preset | Vite |
| Build Command | `pnpm build:web && pnpm build:server` |
| Output Directory | `dist` |
| Function region | `sin1` (configured in root `vercel.json`) |

Configure the following variables for each deployed environment:

```text
APP_ORIGIN=https://app.example.com
PUBLIC_VIEWER_ORIGIN=https://view.example.com
VITE_PUBLIC_VIEWER_ORIGIN=https://view.example.com
ENABLE_EXPERIMENTAL_COREPACK=1
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<SUPABASE_PUBLISHABLE_KEY>
DATABASE_URL=postgresql://easy_dashboard_runtime.<PROJECT_REF>:<PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require
```

`APP_ORIGIN` is an exact security boundary for authenticated mutations. Preview
deployments therefore need their own matching `APP_ORIGIN`, or a stable preview
hostname whose value can be configured ahead of time.

The root project serves the Vite application and `/api/*` Hono routes from the
same origin. Its Node Functions run in Singapore (`sin1`).

## 3. Vercel Project: public viewer

Create a second Vercel Project from the same repository:

| Setting | Value |
| --- | --- |
| Root Directory | `viewer` |
| Framework Preset | Vite |
| Build Command | `pnpm build` |
| Output Directory | `dist` |

Keep Vercel's source-outside-root access enabled because the viewer workspace
reuses renderer code from the repository root. `viewer/vercel.json` rewrites all
viewer routes, including `/view/:slug`, to `index.html`.

The viewer has exactly these public build variables:

```text
VITE_PUBLIC_VIEWER_ORIGIN=https://view.example.com
VITE_PUBLIC_API_ORIGIN=https://app.example.com
ENABLE_EXPERIMENTAL_COREPACK=1
```

`VITE_PUBLIC_VIEWER_ORIGIN` must equal the viewer's own origin.
`VITE_PUBLIC_API_ORIGIN` must point to the authenticated app/API origin.
Corepack makes Vercel honor the repository's pinned pnpm 10 version in both
workspace projects.

Never configure `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, a `service_role` key, or any other private credential
in the viewer project. Published reads use the app project's public endpoint
with credentials omitted, and the viewer origin must remain cookie-less.

## 4. Release checks

Before promoting a deployment:

1. Run `pnpm install --frozen-lockfile`.
2. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
3. Confirm the app hostname can sign in and mutate only with its exact origin.
4. Confirm `https://view.example.com/view/<slug>` loads after a direct refresh.
5. Confirm the viewer request to `/api/public/projects/<slug>` targets the app
   origin and sends no cookies.
6. Confirm the viewer deployment contains none of the Supabase or database
   variables listed above.
