# EasyDashboard Desktop Screen Matrix

Status: active design contract

Scope: desktop only

## Core model

```text
Personal space
└── Project
    ├── Pages (one or more)
    ├── Draft document
    ├── Automatic and manual restore points
    ├── Thumbnail
    └── Releases
        ├── Stable latest URL
        └── Immutable version URLs
```

The current product is personal-first. Team and organization concepts remain
reserved.

## Route inventory

| Surface | Route | Required states |
| --- | --- | --- |
| Login | `/login` | default, submitting, invalid credentials, OAuth error |
| Sign up | `/signup` | default, submitting, validation error, confirmation |
| Forgot password | `/forgot-password` | default, sending, sent, failure |
| Reset password | `/reset-password` | default, invalid link, saving, success |
| Home | `/` | loading, populated, first-use empty, partial failure |
| Projects | `/projects` | grid, list, search, filters, empty, error, create dialog |
| Recycle bin | `/trash` | populated, empty, restore, permanent-delete warning |
| Settings | `/settings` | profile, security, account state |
| Editor | `/projects/:projectId/editor` | loading, ready, dirty, saving, saved, conflict, failure |
| Draft preview | `/projects/:projectId/preview` | loading, page selected, invalid page, render error |
| Stable public view | `/view/:slug` | redirect, loading, published, 404 |
| Version public view | `/view/:slug/versions/:releaseNumber` | loading, published version, 404 |
| Unknown route | `*` | deliberate product 404 |

`TemplatesPage.tsx` currently exists but is not registered in the router. It is
not part of current primary navigation.

### Current implementation gaps

This matrix is the target contract, not a claim that every state is already
implemented. The current source still has these known gaps:

- the wildcard application route redirects to `/`; the target is a deliberate
  product 404;
- draft preview accepts `?page=<pageId>`, but has no product-level page
  selector;
- editor preview opens a new tab, while the home-page fallback preview link
  still replaces the current tab;
- selecting an editor page does not yet write route-restorable page state;
- a new project starts at the default resolution and is adjusted later from the
  canvas HUD; the creation dialog does not ask for resolution;
- release history is inspectable, but release rollback has no verified
  front-end flow.

## Navigation model

### Workspace shell

```text
EasyDashboard
├── Home
├── All projects
├── Recycle bin
├── Settings
└── Account
```

The sidebar is stable and compact. Creating a project remains the primary
workspace action.

### Editor focus shell

```text
Back to projects
├── Project / current page
├── Last saved time
├── Undo / redo
├── Canvas / code mode
└── Supporting actions
    ├── Preview
    └── Publish and share

Icon rail
├── Pages
├── Outline
├── Components / materials
├── Data sources
├── Methods and state
├── Theme
├── Thumbnail
└── Versions
```

Only icons remain visible in the collapsed rail. The active panel provides the
text label and close action.

## Flow contracts

### Core authoring flows

#### Create and enter a project

```text
Projects
  -> New project
  -> Name and optional description
  -> Create
  -> Editor opens on Page 01
  -> Adjust resolution from the canvas HUD when needed
```

Acceptance:

- resolution belongs to the project, not account settings;
- the editor shows a return action;
- the canvas renders on first entry and after refresh;
- the page list contains at least one valid page;
- creation errors keep entered values.

#### Edit a multi-page project

```text
Editor
  -> Add / duplicate / rename / reorder pages
  -> Select a page
  -> Edit canvas
  -> Save draft
```

Acceptance:

- current page is reflected in the URL or restorable route state;
- switching pages does not discard unsaved work without warning;
- one page can be marked as the start page;
- deleting the final page is prevented;
- the project header shows page position or count where useful;
- direct refresh restores the active canvas.

#### Recover work

```text
Editor
  -> Versions
  -> Inspect automatic or manual restore point
  -> Restore
  -> Create pre-restore backup
  -> Continue editing
```

Acceptance:

- undo and redo are described as session history;
- restore points are described as persistent;
- timestamp and save source are visible;
- restoring names the affected project and page scope;
- a conflict is not presented as a generic save failure.

### Supporting lifecycle flows

#### Preview

```text
Editor
  -> Preview
  -> New browser tab
  -> Select or deep-link a page
  -> Return to the still-open editor tab
```

Acceptance:

- preview does not replace the editor route;
- draft preview does not create a public release;
- invalid pages show a recoverable message;
- rendering errors identify the affected page;
- canvas resolution is preserved with proportional scaling.

#### Publish and share

```text
Editor
  -> Publish and share
  -> Publish saved draft
  -> Copy stable latest URL
  -> Optionally open immutable version URL
```

Acceptance:

- unsaved work cannot be mistaken for published content;
- stable and version URLs are labeled by behavior, not implementation;
- the stable URL remains unchanged after later releases;
- release time and version are visible;
- copying a URL gives immediate feedback;
- unpublishing explains that every public URL will return 404.

## Page-level design contracts

### Authentication

Must show:

- canonical product mark;
- one real multi-page calibration scene;
- one focused form;
- direct OAuth option when configured;
- field-level and credential-level errors.

Must not show:

- three feature columns;
- fake KPI dashboards;
- generic AI prompt or model selector;
- marketing navigation.

### Home

Purpose: resume work quickly.

Content:

- recently edited projects;
- recently published projects;
- clear new-project action;
- compact saved and published metadata.

The home page does not duplicate the full project manager.

### Project space

Purpose: find, create, organize, restore, or remove projects.

Desktop density:

- compact preview cards or rows;
- believable 16:9 thumbnails;
- three to four columns only when card width remains useful;
- grid/list control;
- search and filters stay visible during empty results.

Each project exposes:

- name;
- page count;
- draft or published state;
- last saved time;
- favorite state;
- overflow actions.

### Editor

Purpose: author one page while maintaining project-level context.

Non-negotiable areas:

- 48 px header;
- icon-only tool rail;
- one active left panel;
- centered calibrated canvas;
- bounded right inspector;
- bottom-center resolution and zoom HUD.

Long labels and values wrap or truncate inside the inspector. They never escape
the panel width.

### Draft preview

Purpose: inspect the saved project without editor chrome.

It includes only the controls required to:

- identify draft status;
- select a page;
- fit or scale the screen;
- return or close the tab.

### Public viewer

Purpose: display one published release without private application state.

It has:

- no authenticated workspace navigation;
- no draft data;
- proportional screen scaling;
- optional page navigation when the project contains multiple pages;
- explicit loading, render failure, and 404 states.

### Publish and share dialog

Required sections:

1. current publication status;
2. stable latest URL;
3. current immutable version URL;
4. publication history;
5. publish-new-version action;
6. unpublish warning.

Publication history is currently inspectable. Release rollback is not presented
as available until a front-end flow is implemented and verified.

## Cross-screen states

| State | Visual contract |
| --- | --- |
| Loading | preserve final structure; use quiet scan or skeleton feedback |
| Empty | name why it is empty; offer one primary action |
| Search empty | preserve filters; echo query; offer `清除筛选` |
| Error | name failed operation; keep unaffected content; offer `重试` |
| Offline | distinguish network state from validation or authorization |
| Saving | persistent header status; no repeated success toast |
| Saved | include last saved time |
| Conflict | explain local versus remote choice; use conflict color and icon |
| Published | include version and publication time |
| Unpublished | explain that public URLs return 404 |
| Disabled | retain readable label and explain prerequisite when unclear |

## Current, reserved, and excluded

| Capability | Status | Design treatment |
| --- | --- | --- |
| Multi-page project | Current | first-class in editor; preview selector remains a tracked gap |
| Draft save | Current | persistent editor-header state |
| Undo / redo | Current | session-only history |
| Restore points | Current | dedicated Versions panel |
| Stable latest URL | Current | primary share path |
| Immutable release URL | Current | history and audit path |
| Release rollback UI | Not current | do not imply availability |
| Templates route | Not current | reserve, do not expose in nav |
| OAuth | Current when configured | direct auth option |
| Agent | Reserved | no primary navigation |
| 2D / 3D / Cesium content | Reserved | belongs to future screen components |
| Team workspace | Reserved | current IA remains personal-first |
| Mobile editor | Excluded for this phase | desktop only |

## Browser verification matrix

Use at least these desktop viewports:

| Viewport | Purpose |
| --- | --- |
| 1440 x 900 | minimum primary authoring review |
| 1920 x 1080 | common screen-production workstation |
| 2560 x 1440 | wide workspace and dense project grid |

For each critical flow:

1. enter through its real route;
2. reload the page;
3. use every visible primary action;
4. switch away and back when route state matters;
5. inspect console errors;
6. capture a screenshot;
7. verify keyboard focus and escape behavior;
8. verify long Chinese text and narrow panel content.
