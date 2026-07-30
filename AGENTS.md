# EasyDashboard Agent Guide

This file applies to the entire `EasyDashboard` repository.

## Product contract

- The product core is a multi-page big-screen project and its editor.
- Project management, recovery, preview, publishing, sharing, templates, and
  future Agent capabilities support the editor; they must not displace it in
  navigation or visual hierarchy.
- The current product is desktop-first and personal-first.
- Templates, Agent workflows, team workspaces, 3D editing, and mobile authoring
  remain reserved until their own contracts are approved.

## Sources of truth

Use these authorities in order:

1. Existing runtime behavior and tests describe what is implemented now.
2. `docs/PRODUCT-DESIGN.md` defines approved product and visual decisions.
3. `docs/design/SCREEN-MATRIX.md` defines required desktop routes, states, and
   known implementation gaps.
4. `docs/design/foundations.html` is the visual calibration target.
5. Figma is reference-only and non-authoritative for the current design work.

When implementation and design disagree, classify the difference explicitly as
an implementation gap, a contract change, or a design correction. Do not
silently treat a target state as an existing capability.

## Repository architecture

This is a pnpm workspace with three runtime surfaces:

- `src/`: authenticated React application and EasyEditor-based editor;
- `server/`: portable Hono API and local Node adapter;
- `viewer/`: separate cookie-less public viewer.

Supabase provides PostgreSQL, Auth, and Storage. Ordered migrations live under
`supabase/migrations/`. Project documents are server-persisted; do not
reintroduce LocalStorage as an authoritative project store.

## Product UI rules

- Use the canonical logo from `src/assets/logo.svg` or `public/logo.svg`.
- Keep the product shell theme separate from user-authored big-screen themes.
- Preserve the color responsibilities defined in `docs/PRODUCT-DESIGN.md` and
  `src/styles/global.css`; brand cyan and editor selection blue are not
  interchangeable.
- Prefer existing shadcn/ui and Radix primitives before adding UI dependencies.
- Keep the editor rail icon-only, the active panel bounded, and long inspector
  content wrapped or truncated.
- Canvas resolution belongs to the current project/page workflow and remains in
  the bottom canvas HUD, not account settings.
- Preview should preserve the editor by opening a new tab. Stable public URLs
  point to the latest release; version URLs are immutable.

## Verification

For affected behavior, verify the real route and data state:

1. navigate directly and refresh;
2. switch away and back when route state matters;
3. exercise every visible primary action in scope;
4. inspect browser console errors;
5. verify loading, empty, error, and populated states as applicable;
6. visually inspect desktop screenshots at `1440 x 900` and `1920 x 1080`;
7. confirm product-shell styling does not leak into the rendered big screen.

Run targeted tests first, then the relevant combination of:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

If the pnpm launcher cannot switch versions because the registry is
unavailable, use checked-in local binaries for scoped checks rather than
changing package-manager security settings.

## Git hygiene

- Preserve unrelated user changes in a dirty worktree.
- Stage explicit pathspecs and inspect the staged diff before committing.
- Keep product/design-only commits separate from runtime implementation unless
  the user explicitly asks for a combined commit.
