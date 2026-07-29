# EasyDashboard V1 Design

## Design thesis

EasyDashboard is a precision workspace for building data screens, not a generic
AI SaaS dashboard. The UI should feel like a quiet calibration instrument:
dark, exact, content-led, and visibly connected to canvas size, rulers, and
publishing state.

The user is a dashboard maker. The main job of the application shell is to help
them find a project, understand its state, and enter the editor quickly.

## Token system

### Color

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `#080A0D` | application background |
| Rail | `#0F1318` | sidebar and fixed headers |
| Surface | `#171D24` | active rows and raised controls |
| Hairline | `#2A333D` | borders, dividers, input outlines |
| Chalk | `#F1F5F7` | primary text |
| Signal | `#67C6D9` | focus, publishing state, calibration details |

Semantic success, warning, and error colors stay restrained: icon, text, and a
one-pixel status line rather than large tinted panels.

### Type

- Display and Chinese headings: Alibaba PuHuiTi, 24–32 px.
- Body and controls: Alibaba Sans, 13–15 px.
- Resolution, timestamps, state codes, and technical metadata: a monospace
  system stack, 11–12 px.

### Shape and spacing

- Four-pixel spacing grid: `4 / 8 / 12 / 16 / 24 / 32 / 48`.
- Standard control height: 36 px.
- Authentication inputs and primary actions: 44 px.
- Control radius: 6 px; project cards: 10 px; primary viewport: 14 px.
- Shadows are reserved for dialogs and popovers. Cards use surface contrast and
  hairlines.

## Signature: Calibration Viewport

The recurring visual signature is a 16:9 viewport frame with asymmetric crop
corners, a center tick, a resolution readout, and a small state label.

```text
┌─ 1920 × 1080 · DRAFT ──────────────┐
│  ┌                                  │
│            dashboard preview        │
│                                ┘    │
└──────────────────────────── 100% ───┘
```

It appears only in the authentication visual, project previews, and empty
states. On hover, the four crop corners move inward by four pixels and one
180 ms signal line travels along the bottom edge. There is no neon glow.

## Page composition

### Authentication

Desktop uses a 58/42 split. The left side contains the brand and a real
calibration viewport. The right side contains a 380 px form without a floating
glass card. A single vertical hairline separates the two zones.

On small screens, the large viewport is replaced by a compact calibration band
above the form. Field errors sit next to their fields; the general credential
error reads “邮箱或密码不正确” and preserves the entered email.

### Project home

- Fixed 232 px sidebar; 56 px icon rail below 1280 px; shadcn `Sheet` on mobile.
- Main content is capped at 1440 px with 40–48 px desktop padding.
- Project grid uses `minmax(290px, 1fr)`: three columns at normal desktop,
  four on wide screens, two on tablet, and one on mobile.
- A project card shows a real rendered preview, project name, draft/published
  state, updated time, and overflow actions.
- “新建项目” is the only high-emphasis action.
- No prompt composer, model selector, chat history, sparkle icon, or generic
  colored icon tile appears in V1.

### Application sidebar

- Workspace group: projects, templates, recent items.
- System group: settings.
- Account control is anchored at the bottom.
- Active rows use the raised surface plus a two-pixel Signal line.
- The editor is a focus route and does not nest the application sidebar. Its
  header gains only a back action, project name, save state, preview, and
  publish controls.

## States

- Empty projects: one 520 px calibration viewport, “还没有项目”, primary
  “新建空白项目”, secondary “从模板开始”.
- Search empty: keep filters visible, name the unmatched query, offer
  “清除筛选”.
- Loading: structural project-card skeletons and one low-contrast scan line.
- Failure: preserve the page structure, say exactly what failed, and provide
  “重试”. Technical details stay collapsed.
- Saving and publishing: persistent editor-header state rather than repeated
  toast notifications.
- Deletion: name the project and consequence; the destructive action is not the
  default focus.

## Motion and accessibility

- One initial sequence: heading, toolbar, and grid, 40 ms stagger, no more than
  260 ms total.
- Card hover is limited to a two-pixel lift and crop-corner movement.
- Focus uses a two-pixel Signal ring with a two-pixel offset.
- Icon-only actions require an accessible label and tooltip.
- Touch targets are at least 44 px.
- State is never communicated by color alone.
- `prefers-reduced-motion` disables the viewport line and entrance motion.

## Self-critique

The first direction inherited a centered AI prompt, model picker, colorful
template tiles, and glowing dark surfaces from common generated SaaS designs.
Those choices did not express dashboard construction and contradicted the
decision to defer Agent work.

The revised direction removes the prompt-first home entirely. Its only visual
risk is the calibration viewport, which comes directly from EasyDashboard's
resolution, ruler, preview, and publishing concepts. Everything around that
signature stays quiet and uses existing shadcn primitives.
