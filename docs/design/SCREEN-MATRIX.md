# EasyDashboard Desktop Screen Matrix

Status: active design contract

Scope: desktop current product plus remaining Agent V1 hardening contract

## Core model

```text
User
├── Private cross-project preferences
└── Project membership
    └── Project
        ├── Private conversations owned by this user
        ├── Shared Project Context
        ├── Project assets and data connections
        ├── Pages (one or more)
        ├── Draft document
        ├── Automatic and manual restore points
        ├── Thumbnail
        └── Releases
            ├── Stable latest URL
            └── Immutable version URLs
```

The current UI is an Agent-first personal workspace. Conversations remain private
to their creator; shared project facts live in the visible and versioned
`项目上下文`. The existing owner/editor/viewer groundwork is not yet a complete
member-management product. Organization workspaces and real-time collaboration
remain reserved.

## Route inventory

| Surface | Route | Phase | Required states |
| --- | --- | --- | --- |
| Login | `/login` | Current | default, submitting, invalid credentials, OAuth error |
| Sign up | `/signup` | Current | default, submitting, validation error, confirmation |
| Forgot password | `/forgot-password` | Current | default, sending, sent, failure |
| Reset password | `/reset-password` | Current | direct-access invalid, callback-ready form, saving, success |
| Agent home | `/` | Current | loading, first use, ready, creating, create failure, model blocked |
| Projects | `/projects` | Current | grid, list, search, filters, empty, error, create dialog |
| Recycle bin | `/trash` | Current | populated, empty, restore, permanent-delete warning |
| Settings | `/settings` | Current | profile, security, Agent preferences, personal model, budget, account state |
| Project Agent | `/projects/:projectId/agent/:conversationId?` | Current | loading, ready, queued, running, waiting, failed, indeterminate, completed, rolled back |
| Project settings | `/projects/:projectId/settings` | Follow-up | members, project model, budget, connections, Skill, MCP, authorization |
| Editor | `/projects/:projectId/editor` | Current | loading, ready, dirty, saving, saved, conflict, Agent dock |
| Draft preview | `/projects/:projectId/preview` | Current | loading, page selected, invalid page, render error |
| Stable public view | `/view/:slug` | Current | redirect, loading, published, 404 |
| Version public view | `/view/:slug/versions/:releaseNumber` | Current | loading, published version, 404 |
| Unknown route | `*` | Current | deliberate product 404 |

`TemplatesPage.tsx` currently exists but is not registered in the router. It is
not part of current primary navigation.

### Current implementation coverage

The current source covers the Agent-first atomic start, private multi-conversation
workspace, visible tasks, execution recovery, shared Project Context, attachment
inputs, model and budget settings, Agent dock, and undo. It also covers the
deliberate product 404, explicit auth recovery states, truthful home and
recycle-bin failures, draft preview page selection and fit/scale controls,
new-tab preview entry points, route-restorable editor pages, per-page resolution
choice, permanent deletion, and restoring an immutable release into the draft.

## Navigation model

### Workspace shell

```text
EasyDashboard
├── Agent home
├── All projects
├── Recycle bin
├── Settings
└── Account
```

The sidebar is stable and compact on workspace index routes. Starting from a
goal is the primary home action; creating an empty project remains a secondary
action. Project Agent and editor routes do not carry this global sidebar.

### Agent project shell

```text
Project header
├── Back to workspace
├── Draft revision and save state
├── Project Context
├── Manual edit handoff
└── Full preview

Conversation dock
├── One compact conversation dropdown
├── New private conversation
├── Messages
├── Exactly one current Todo above the composer
└── Composer

Project preview
├── Current page
├── Fit / scale
├── Selection context
└── Verification HUD
```

The route has no global workspace rail. The preview gets the flexible and
dominant area. Historical messages never repeat Todo panels. Tool logs and Token
details remain expandable instead of becoming another permanent panel.

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

#### Start from a goal

```text
Agent home
  -> Enter goal and optional references
  -> Send
  -> Atomically create Project + private Conversation + Task + Outbox
  -> Open Project Agent route
  -> Background task continues if the page closes
```

Acceptance:

- one idempotency key cannot create duplicate projects or tasks;
- the user never sees a project without its initial conversation and task;
- project name and resolution can be inferred, explicitly set, or edited later;
- target resolution precedence is current input, user preference, workspace
  default, then 1920 x 1080;
- uploaded material defaults to `仅本对话`, clearly shows visibility, and
  requires explicit promotion before becoming `项目资料`;
- creation failure preserves the message and selected files;
- `创建空白项目` remains directly available.

#### Create and enter a project

```text
Projects
  -> New project
  -> Name, optional description, and initial-page resolution
  -> Create
  -> Editor opens on Page 01
  -> Adjust each page later from the canvas HUD when needed
```

Acceptance:

- resolution belongs to each project page, not account settings;
- custom width and height are positive integers capped at 16384 pixels;
- the editor shows a return action;
- the canvas renders on first entry and after refresh;
- the page list contains at least one valid page;
- creation errors keep entered values.

This manual flow remains supported but is no longer the default home journey.

#### Continue through private conversations

```text
Project Agent
  -> Resume recent private conversation or create another
  -> Submit task
  -> See one current Todo trace directly above the composer
  -> Answer material question or authorization request
  -> Inspect verified result
  -> Continue, undo, or enter manual editor
```

Acceptance:

- conversations are scoped to project and creator;
- other project members, including Owner, cannot read their content;
- multiple conversations can exist for one user and project;
- only one project write stage holds the write lease at a time;
- queued writers revalidate the latest draft revision;
- closing the page does not cancel work;
- task progress reconnects without duplicating events.

#### Agent and manual editing

```text
Project Agent
  <-> Manual editor with lightweight Agent dock
```

Acceptance:

- both modes use the same project draft and revision chain;
- switching preserves conversation, task, cost, authorization, page, and
  relevant selection state;
- the dock resumes a selected conversation instead of creating a shadow one;
- manual edits win over a stale Agent ChangeSet;
- the Agent re-observes after a draft conflict;
- every writing task exposes `撤销本次修改`;
- undo preserves later unrelated work and stops for a same-path conflict;
- full-project history restore remains a separate explicitly destructive choice.

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

#### Maintain Project Context

```text
Completed task
  -> Agent saves a private pending context delta
  -> User reviews and selects Confirm and share
  -> Entry becomes confirmed
  -> Members consume confirmed normalized facts
  -> Edit / delete / compare / rollback
```

Acceptance:

- the surface is named `项目上下文`;
- automatic summary creates a private pending proposal, not an automatic share;
- shared entries never reveal another member's private message or attachment;
- only confirmed entries enter another member's model context;
- every change records version, source type, confirmer, and time;
- user preferences remain private and separate;
- current explicit instruction overrides project context and user preference.

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
Agent or Editor
  -> Run real read-only preview verification
  -> Create immutable Publish Snapshot
  -> Owner approves the exact Snapshot
  -> Publish
  -> Copy stable latest URL
  -> Optionally open immutable version URL
```

Acceptance:

- unsaved work cannot be mistaken for published content;
- stable and version URLs are labeled by behavior, not implementation;
- the stable URL remains unchanged after later releases;
- release time and version are visible;
- copying a URL gives immediate feedback;
- unpublishing explains that every public URL will return 404;
- approval binds the exact Snapshot hash and expires when content changes;
- preview verification cannot call an external write capability;
- publish failure keeps the previous online release available;
- retrying the same Snapshot is idempotent.

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

Purpose: start or resume real dashboard work.

Content:

- primary goal composer;
- optional image, file, and data-sample attachments;
- model destination and budget state without exposing secrets;
- recent private conversations;
- recently edited projects;
- recently published projects;
- secondary empty-project action;
- compact saved and published metadata.

The home page does not duplicate the full project manager.

### Project Agent

Purpose: turn a private conversation into visible and recoverable project work.

Non-negotiable areas:

- one compact dropdown for the current user's private conversations;
- readable conversation with historical messages only;
- exactly one current Todo directly above the composer;
- largest-available live project preview;
- quiet handoff to manual editing;
- current revision, task state, cost, and authorization;
- Project Context access;
- pause, cancel, resume, and `撤销本次修改`;
- expandable technical details without hidden reasoning.

The route never renders the global workspace rail. At narrow desktop widths,
the conversation dock stays within its 360–430px contract before the preview is
allowed to become secondary.

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
as a change to the public pointer. Each immutable release can instead be
restored into the current draft after explicit confirmation. The restore creates
a `pre_restore` backup, replaces every draft page, and leaves all currently
published URLs unchanged until the user publishes again.

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
| Queued | show queue position or reason without implying active execution |
| Waiting user | keep the exact blocking question and resume action |
| Waiting authorization | name Owner, resource, scope, and side effect |
| Paused | preserve completed milestones and explain resume point |
| Budget warning | show consumed amount, threshold, and actual/estimated label |
| Budget hard stop | stop before the next paid call; keep committed stages |
| Billing indeterminate | show possible upstream charge and require retry choice |
| Verification failed | name target resolution, failed check, and repair action |
| Rolled back | name restored revision and preserved conversation |
| Indeterminate | prohibit automatic retry and explain evidence recovery |

## Current, reserved, and excluded

| Capability | Status | Design treatment |
| --- | --- | --- |
| Multi-page project | Current | first-class in editor and draft preview |
| Draft save | Current | persistent editor-header state |
| Undo / redo | Current | session-only history |
| Restore points | Current | dedicated Versions panel |
| Stable latest URL | Current | primary share path |
| Immutable release URL | Current | history and audit path |
| Restore release as draft | Current | full-project restore with pre-restore backup; public pointer unchanged |
| Templates route | Not current | reserve, do not expose in nav |
| OAuth | Current when configured | direct auth option |
| Agent-first home | Current | primary creation entry with atomic project/conversation/task start |
| Private multi-conversation Agent | Current | project + user scoped and server synchronized |
| Project Context | Current | private pending plus shared confirmed CAS editing and rollback |
| User preferences | Current | private, server-backed, and cross-project |
| Background Agent tasks | Current baseline | durable operation, polling recovery, visible stages, and indeterminate state; no event stream yet |
| Basic owner/editor/viewer membership | Follow-up; space-level schema groundwork exists | project-scoped roles, no real-time collaboration |
| Controlled Skill / MCP | Contract baseline | built-in Skill selection and trace plus MCP authorization policy; no end-user MCP surface |
| AI image generation | Not V1 | optional later Skill |
| 2D / 3D / Cesium dashboard content | Reserved | belongs to future screen components; current shell depth is UI-only Motion parallax |
| Organization / real-time team workspace | Reserved | no CRDT, cursor, or live merge |
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

For Agent V1 regression verification and remaining hardening, also verify:

9. first-message idempotency and failure recovery;
10. private conversations with two users in the same project;
11. one active write lease across multiple conversations;
12. page close and event-stream reconnect during a task;
13. Agent/manual mode continuity and stale-revision handling;
14. budget warning and hard stop;
15. Owner-only high-risk authorization;
16. `撤销本次修改`;
17. read-only real preview at the project target resolution;
18. publish approval bound to an immutable Snapshot.

### 2026-07-30 desktop acceptance record

The current product loop was exercised against the normal local web, Viewer,
and Hono services rather than a separate demo server:

- 1440 x 900: editor rail, component drag, setters, resolution HUD, and Settings;
- 1920 x 1080: Home density and recent-project layout;
- 2560 x 1440: project grid and 2K editor canvas;
- multi-page editor route survived a full reload;
- draft preview opened the active page in a new tab and kept page selection,
  URL, return target, fit, 100%, and zoom controls aligned;
- two releases proved stable-latest and immutable-version behavior;
- restoring release 1 created a pre-restore backup while stable latest remained
  on release 2;
- unpublishing made the stable link and every release link return the branded
  404 state;
- the disposable project was moved through Trash and permanently deleted only
  after exact-name confirmation.
