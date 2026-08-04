# EasyDashboard Product Design

Status: current visual foundation and Agent V1 core authoring loop implemented

Scope: desktop product shell, Agent workspace, editor, preview, and publishing

Last updated: 2026-07-31

## Product definition

EasyDashboard is a workspace for building and publishing multi-page big-screen
projects.

The editable big-screen project is the product core. Project management,
account access, Agent creation, manual editing, recovery, preview, publishing,
sharing, and future extensions exist to help users create and maintain that
project.

Agent V1 changes the default creation path, not the content model. A user starts
from a goal, optional reference image, file, or data sample; the first submitted
message now creates a project, a private conversation, and a task as one server
operation. The Agent and manual editor then modify the same draft and recovery
history. Publishing remains an explicit existing product action rather than an
Agent-controlled side effect.

A project is not a single canvas:

```text
User
└── Project
    ├── Private conversations owned by this user
    ├── Shared Project Context
    ├── Project assets and data connections
    ├── Page 01 · Overview
    ├── Page 02 · Regional detail
    ├── Page 03 · Device status
    ├── Draft document
    ├── Restore points
    └── Published releases
```

The end-to-end lifecycle is:

```text
Goal / files / existing project
  -> Agent plan and staged project changes
  <-> Manual multi-page editor
  -> Real preview verification
  -> Save / restore point / undo this task
     [authoring and verification core]
  -> Preview in a new tab
  -> Owner-authorized publish / share
     [delivery extensions]
```

The authoring core ends with a saved, recoverable, editable, and verified
multi-page project. Conversation is an input and control surface, not the
deliverable. Preview, publishing, and sharing complete delivery, but remain
grounded in the exact project revision the user inspected.

## Experience principles

### 1. The deliverable artifact is the center

The live project preview and editor get the strongest visual hierarchy and the
most deliberate interaction design. Agent mode may be the default entry, but it
must keep the affected project, revision, preview, verification, and recovery
visible. Entry and account pages inherit the editor's language; they do not
define a separate marketing or chatbot identity.

### 2. One project, multiple pages

Page count, current page, start page, and page switching are first-class
information. Project thumbnails and editor headers must never imply that one
project equals one page.

### 3. Persistent state is visible

Users should always be able to distinguish:

- unsaved local edits;
- saved draft state;
- in-memory undo and redo;
- persistent restore points;
- immutable published releases;
- the stable URL that always resolves to the latest publication.

### 4. Precision before decoration

The interface should feel like a calibrated visual instrument: exact, quiet,
and dense enough for professional work. Grid, ruler, resolution, alignment, and
publication state are meaningful visual material. Decorative glass cards,
generic neon, and colorful icon tiles are not.

### 5. Product chrome and screen content are separate systems

EasyDashboard controls the editor and application shell. The user controls the
theme of the big screen. Product colors must not be injected into a published
screen unless the user explicitly chooses them.

### 6. Agent and manual editing are one workflow

Agent mode and the manual editor are peer modes over one project. Switching
between them preserves the current private conversation, task state, draft
revision, cost, and authorization state. A lightweight Agent dock in the editor
must not create a shadow session.

### 7. Privacy, cost, and recovery are visible state

Private conversations remain private to their creator. Shared project facts
enter the visible, editable, versioned `项目上下文`. Model destination, actual or
estimated cost, waiting authorization, verification, and `撤销本次修改` appear
where the work happens rather than in hidden administrative logs.

## Visual direction: Calibration Viewport

The visual signature is called `Calibration Viewport` or `暗夜标定`.

It combines:

- a deep-ink workspace;
- restrained hairlines and surface steps;
- ice-cyan brand signals;
- precision-blue selection and transform feedback;
- ruler ticks, coordinates, resolution readouts, and crop corners;
- a subtle multi-plane composition that suggests one project containing
  several pages.

This signature appears in:

- authentication visual areas;
- empty and loading states;
- project thumbnails;
- the canvas workspace;
- the repository visual reference at
  [`design/foundations.html`](./design/foundations.html).

It does not become a decorative frame around every card.

## Color contract

### Product shell

The current implementation variables in `src/styles/global.css` are the
canonical code mapping.

| Role | CSS variable | Value | Use |
| --- | --- | --- | --- |
| Deep ink | `--ed-canvas` | `#070A0F` | application and editor background |
| Rail | `--ed-rail` | `#0A0E14` | fixed navigation and editor rails |
| Panel | `--ed-panel` | `#0D131B` | side panels and inspector |
| Raised | `--ed-panel-raised` | `#121B26` | controls, active rows, popovers |
| Hairline | `--ed-line` | `#1C2936` | borders and separators |
| Strong line | `--ed-line-strong` | `#2A3B4C` | high-emphasis boundaries |
| Primary ink | `--ed-ink` | `#EDF5FA` | primary text |
| Soft ink | `--ed-ink-soft` | `#BDCAD4` | secondary text |
| Muted ink | `--ed-ink-muted` | `#8B9CA9` | metadata and inactive labels |
| Faint ink | `--ed-ink-faint` | `#748695` | rulers and low-emphasis hints |
| Precision blue | `--ed-blue` | `#4F8CFF` | selection, marquee, handles |
| Ice signal | `--ed-cyan` | `#6DDCF3` | brand, focus, active navigation |

### Color responsibility

Ice signal and precision blue are intentionally different:

- `#6DDCF3` says “this belongs to EasyDashboard” or “focus is here”;
- `#4F8CFF` says “this object is selected or being transformed”.

Do not turn every selected control cyan. Do not use the brand color as the
default chart palette for user screens.

Status colors are semantic and restrained:

| Status | Value | Typical use |
| --- | --- | --- |
| Success | `#52D28B` | saved, published, connected |
| Warning | `#F59E0B` | unsaved risk, expiring access |
| Error | `#FF7F8A` | failed save, invalid input, unavailable |
| Conflict | `#D99A4E` | remote draft conflict, restore warning |

State must never depend on color alone. Pair color with an icon, label, shape,
or position.

## Typography contract

The repository includes the real web fonts, so the code-native reference can
show the intended typography without relying on a design-tool subscription.

| Role | Font | Size range | Use |
| --- | --- | --- | --- |
| Product display | Alibaba Sans | 28-40 px | product name and rare display text |
| Chinese headings | Alibaba PuHuiTi | 16-28 px | page and panel headings |
| Product body | Alibaba Sans / PuHuiTi fallback | 13-16 px | controls and descriptions |
| Technical data | system monospace | 11-13 px | resolution, coordinates, IDs, time |

The code stack remains:

```css
--font-sans: "Alibaba Sans", "Alibaba PuHuiTi", system-ui, sans-serif;
--font-display: "Alibaba PuHuiTi", "Alibaba Sans", system-ui, sans-serif;
--font-mono: "SF Mono", Consolas, Monaco, "Liberation Mono", monospace;
```

Text rules:

- headings are short and structural;
- controls use plain verbs: `保存`, `预览`, `发布`;
- an action keeps the same name through its result;
- errors name what failed and offer a next step;
- empty states invite one concrete action;
- technical metadata uses monospace only when alignment or scanning benefits.

## Geometry and density

### Spacing

Use a four-pixel foundation with two-pixel precision adjustments:

```text
2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64
```

### Radius

```text
4 px  small icon and compact control
6 px  dense editor control
8 px  default control and active row
10 px panel and project preview
12 px dialog and floating surface
16 px signature viewport only
```

Large pill shapes are reserved for values that are truly compact and
self-contained, such as a status chip. They are not the default container.

### Control height

| Control | Height |
| --- | --- |
| compact editor action | 28 px |
| standard editor action | 32 px |
| product form control | 36-40 px |
| authentication primary action | 44 px |
| editor top bar | 48 px |

### Depth

Adjacent dark areas are separated in this order:

1. surface value;
2. one-pixel hairline;
3. spacing and grouping;
4. shadow only for floating content.

Persistent panels do not use large shadows. Dialogs, menus, and canvas HUD
controls may use a restrained black shadow. Cyan glow is limited to keyboard
focus and active calibration feedback.

## Brand and iconography

The canonical product mark is:

- `src/assets/logo.svg` inside the application;
- `public/logo.svg` for the favicon and public static access.

Both files contain the same geometric product mark. Documentation logos are not
product assets.

Rules:

- use the full mark and `EasyDashboard` name on authentication and workspace
  entry surfaces;
- use the compact mark in the editor header and icon rail;
- retain `currentColor` behavior so the mark can use primary ink or ice signal;
- use `lucide-react` for interface icons;
- keep icons at 16, 18, 20, or 24 px;
- icon-only controls require a tooltip and accessible label.

## Product shell

### Workspace navigation

Workspace index routes use a stable left sidebar for:

- Agent-first home;
- all projects;
- recycle bin;
- settings;
- account actions.

Project Agent and editor routes leave that shell and open as immersive workbenches. They show one compact return control instead of carrying the global sidebar into the artifact workspace.

Templates may be added later, but an unreachable template page is not exposed as
active navigation.

The active row uses:

- a raised surface;
- brighter icon and label;
- a two-pixel ice-signal marker.

The home page uses the existing shell but makes the start composer its primary
content. Recent private conversations and recent projects help users resume
work. `创建空白项目` remains a visible secondary action.

The project manager remains a compact workspace, not a gallery of oversized
cards. Project previews should preserve a believable screen aspect ratio and
show:

- project name;
- number of pages;
- draft or published state;
- last saved time;
- primary overflow actions.

### Agent project route

Agent V1 provides a full project route at
`/projects/:projectId/agent/:conversationId?`. It is the default project entry
for an authenticated user and uses an immersive header plus two bounded areas:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Back · Project · revision · context · manual edit · full preview      │
├───────────────────────┬──────────────────────────────────────────────┤
│ conversation dock     │ live project preview                         │
│ 360-430 px            │ flexible and dominant                        │
└───────────────────────┴──────────────────────────────────────────────┘
```

The route does not render the global workspace rail. The preview receives the
flexible space, while one compact dropdown in the dock header switches private
conversations. Exactly one current Todo sits above the composer; historical
messages stay as transcript messages and never repeat Todo panels. Tool Calls,
Token details, diagnostics, and receipts are expandable details. Hidden reasoning
is never displayed. The embedded preview is loaded
from a credentialless isolated Origin or process so dashboard lifecycle code and
remote materials do not inherit the authenticated product shell's Cookie or
storage access.

`项目上下文` opens as a reviewable surface with structured facts, confirmation
state, version diff, editing, deletion, and rollback. Members never receive a
link into another user's private source conversation.

### Editor focus route

The editor, like Project Agent, does not nest inside the workspace sidebar.

The desktop structure is:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Back · Project / Page     Saved time    Undo Redo   Preview Publish │
├────┬──────────────┬───────────────────────────────┬─────────────────┤
│    │              │                               │                 │
│icon│ active panel │      calibrated canvas        │    inspector    │
│rail│              │                               │                 │
│    │              │      resolution / zoom        │                 │
└────┴──────────────┴───────────────────────────────┴─────────────────┘
```

The icon rail is icon-only in its collapsed state. The active panel provides
the text title. The inspector must wrap or truncate long values rather than
overflowing its boundary.

The canvas resolution selector belongs to the project page and stays in the
bottom-center canvas HUD. It is not an account preference.

### Canvas interaction

The editor must provide consistent visual feedback for:

- object selection;
- marquee selection;
- resize and rotation handles;
- alignment guides;
- snapping;
- drag targets;
- page boundary;
- zoom;
- project resolution.

The canvas must rehydrate after a full browser refresh and after switching
between project-space and editor routes.

## Preview, publishing, and history

### Preview

Preview opens in a new browser tab so the editing state stays intact.

The target draft preview:

- provides a product-level project-page selector;
- can deep-link with `?page=<pageId>`;
- never exposes unpublished content through the public viewer.

The editor and workspace preview actions open a new tab. Draft preview provides
a project-page selector, preserves `?page=<pageId>`, reports invalid page
references without losing the project, and exposes fit/scale controls without
adding editor chrome.

### Publishing links

Every published project has two link types:

| Link | Contract |
| --- | --- |
| Stable latest URL | address never changes; content follows the newest release |
| Version URL | immutable snapshot of one release |

The publish dialog must label the difference in plain language. Users should not
need to replace an embedded URL after each publication.

Unpublishing invalidates both the stable link and all version links. Public
access then returns a deliberate 404 state.

### Three history layers

| Layer | Lifetime | Purpose |
| --- | --- | --- |
| Undo / redo | editor session | reverse recent local operations |
| Restore points | persistent draft history | recover saved automatic or manual states |
| Releases | immutable publication history | inspect what was publicly available |

Restoring a persistent draft creates a pre-restore backup. An immutable release
can also be restored into the current draft: the server first creates a
`pre_restore` backup, then replaces the full multi-page draft using optimistic
version checking. This operation never moves or republishes the public pointer;
the stable and immutable public URLs keep serving the previously published
content until the user explicitly publishes a new version.

## Authentication

Authentication is a product entry, not a feature brochure.

Desktop uses a split layout:

- left: real product mark and one multi-page calibration scene;
- right: a focused 380-420 px authentication form;
- one hairline separates the zones;
- no three-column feature list;
- no fake dashboard KPI cards;
- third-party OAuth may appear as a direct sign-in option;
- credential errors remain attached to the form and preserve the email value.

Suggested entry message:

> 把大屏当作项目，而不是一张画布。

Supporting copy should explain the real model in one sentence:

> 在同一个项目中组织多个页面，保存可恢复版本，并发布一个持续更新的访问地址。

## Reserved extensions

The following concepts remain reserved and must not shape current primary
navigation:

- templates and a template marketplace;
- 2D map enhancements;
- Three.js and Cesium 3D content;
- organization workspaces and real-time team collaboration;
- open Skill marketplaces and arbitrary third-party MCP;
- AI image generation as a core workflow;
- mobile authoring.

Reserved does not mean hidden implementation commitments. Each extension needs
its own product contract before appearing in the main UI.

## Non-goals

- a generic AI chat that is not bound to a dashboard project;
- an Agent-only workflow that removes manual editing;
- hidden sharing of private conversations or user preferences;
- default multi-Agent execution or hidden model routing;
- a generic SaaS card dashboard;
- a content community or template marketplace in the current core;
- one universal theme shared by product shell and user screens;
- mobile editor design in the current phase;
- decorative 3D that reduces canvas readability;
- large tinted status panels;
- silent fallbacks that hide save, publish, or rendering failures.

## Design artifacts

- [Repository design entry point](../DESIGN.md)
- [Desktop screen and state matrix](./design/SCREEN-MATRIX.md)
- [Code-native visual foundations](./design/foundations.html)
- [Design workspace guide](./design/README.md)
- [Agent V1 product and system contract](./AI-AGENT-PLAN.md)
- [Architecture](./ARCHITECTURE.md)

## Acceptance gate

Before a product UI change is considered complete:

1. Verify the real route and real data state, not only a component story.
2. Test direct navigation and full refresh.
3. Test the empty, loading, error, and populated states affected by the change.
4. Test keyboard focus and icon-only accessible names.
5. Confirm cyan and blue still serve different responsibilities.
6. Confirm product-shell styling did not leak into the rendered big screen.
7. Capture and inspect a desktop screenshot at the intended viewport.
8. Re-run the critical project -> edit -> preview -> publish path when the
   change touches that loop.
9. For Agent changes, verify private conversation isolation, shared Project
   Context boundaries, task persistence, cost labels, and role limits.
10. For Agent writes, verify stale-revision rejection, `撤销本次修改`, and a real
    read-only preview at the project's primary target resolution.
