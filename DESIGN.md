---
name: EasyDashboard
description: A calibrated dark authoring instrument for building, operating, and verifying real dashboard artifacts.
colors:
  canvas-deep: "#070a0f"
  rail-deep: "#0a0e14"
  panel: "#0d131b"
  panel-raised: "#121b26"
  line: "#1c2936"
  line-strong: "#2a3b4c"
  ink: "#edf5fa"
  ink-soft: "#bdcad4"
  ink-muted: "#8b9ca9"
  ink-faint: "#748695"
  selection-blue: "#4f8cff"
  focus-cyan: "#6ddcf3"
  success: "#52d28b"
  warning: "#f59e0b"
  error: "#ff7f8a"
  conflict: "#d99a4e"
typography:
  display:
    fontFamily: "Alibaba PuHuiTi, Alibaba Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.18
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Alibaba PuHuiTi, Alibaba Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Alibaba Sans, Alibaba PuHuiTi, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Alibaba Sans, Alibaba PuHuiTi, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Alibaba Sans, Alibaba PuHuiTi, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
  mono:
    fontFamily: "SF Mono, Consolas, Monaco, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  control-sm: "6px"
  control: "8px"
  panel: "10px"
  overlay: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas-deep}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "32px"
  button-quiet:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "32px"
  input-workbench:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
  panel-workbench:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px"
  workspace-rail-opener:
    backgroundColor: "{colors.rail-deep}"
    textColor: "{colors.ink-muted}"
    width: "32px"
  workspace-rail-docked:
    backgroundColor: "{colors.rail-deep}"
    textColor: "{colors.ink-soft}"
    width: "216px"
  workspace-rail-expanded:
    backgroundColor: "{colors.rail-deep}"
    textColor: "{colors.ink-soft}"
    width: "216px"
---

# Design System: EasyDashboard

## Overview

**Creative North Star: "The Calibration Desk / 标定工作台"**

EasyDashboard is a quiet, professional instrument for producing real dashboard artifacts. The shell uses deep-ink surfaces, restrained hairlines, precise status signals, and functional calibration cues. The dashboard itself remains the dominant artifact; conversation, navigation, and system state support the work without becoming the spectacle.

The visual world rejects generic AI theater: no decorative English eyebrows above every heading, no purple AI gradients, no robot mascots, no excessive glass cards, and no mode chrome that explains what the page already makes obvious. Movement must communicate topology, progress, or depth. Agent and manual editing are two ways to operate the same project, not two competing brands.

Detailed product and runtime contracts remain in `PRODUCT.md`, `docs/PRODUCT-DESIGN.md`, `docs/design/SCREEN-MATRIX.md`, and `docs/AI-AGENT-PLAN.md`. This file is the visual-system source for new or changed surfaces; tests and the rendered application remain implementation truth.

**Key Characteristics:**

- Artifact-first hierarchy with a dominant real renderer.
- Deep matte surfaces separated by tonal steps and 1px hairlines.
- Ice-cyan focus, precision-blue selection, and semantic status colors used sparingly.
- Compact desktop density with clear 12px, 13px, 18px, and 28–32px type roles.
- One-shot spatial motion, stable composers, and complete reduced-motion behavior.
- Instrument-like controls instead of oversized cards or generic SaaS decoration.

## Colors

The palette is a near-black calibration chassis with cool white text and rare, high-information signals. Frontmatter values are normative.

### Primary

- **Ice Signal** (`focus-cyan`): product focus, active navigation marks, keyboard rings, connected or calibrated cues. Keep it rare enough to remain diagnostic.
- **Precision Selection** (`selection-blue`): selected or transformed dashboard objects and explicit artifact selection. It does not replace product focus.

### Secondary

- **Verified Green** (`success`): saved, connected, verified, or completed states.
- **Attention Amber** (`warning`): waiting, budget thresholds, authorization, or recoverable risk.
- **Failure Coral** (`error`): denied or failed actions and destructive confirmation.
- **Revision Ochre** (`conflict`): stale revisions and merge or undo conflicts.

### Neutral

- **Calibration Black** (`canvas-deep`): the deepest workspace and artifact stage.
- **Instrument Rail** (`rail-deep`): persistent and overlay navigation chassis.
- **Matte Panel** (`panel`) and **Raised Panel** (`panel-raised`): controls, transcript surfaces, and hover or selected layers.
- **Hairline** (`line`) and **Structural Line** (`line-strong`): ordinary separation versus major stage boundaries.
- **Chalk Ink** (`ink`), **Soft Ink** (`ink-soft`), **Muted Ink** (`ink-muted`), and **Faint Ink** (`ink-faint`): a four-step text hierarchy.

**The Signal Rarity Rule.** Accent colors indicate state, focus, or selection; they are not ambient decoration.

**The Shell Boundary Rule.** Product-shell colors never leak into a user's dashboard unless the user explicitly chooses them.

## Typography

**Display Font:** Alibaba PuHuiTi with Alibaba Sans and system sans fallbacks.
**Body Font:** Alibaba Sans with Alibaba PuHuiTi and system sans fallbacks.
**Label/Mono Font:** SF Mono, Consolas, Monaco, monospace for resolution, revision, time, coordinates, and cost only.

**Character:** The pairing is practical and calm: Chinese headings remain human and legible while operational text stays compact. Typography creates hierarchy through size and spacing, not through repeated uppercase English labels.

### Hierarchy

- **Display** (400, 32px, 1.18): authentication and rare product-level headlines.
- **Headline** (400, 28px, 1.25): the primary action or greeting on a major surface.
- **Title** (500, 18px, 1.25): project and artifact identity; the Agent toolbar title must not collapse into metadata.
- **Body** (400, 13px, 1.6): conversation and product explanation, normally kept to readable line lengths.
- **Label** (500, 12px, 1.4): structural labels, controls, Todo stage names, and metadata groups.
- **Mono** (400, 11px, 1.4): only values that benefit from fixed-width comparison.

**The One Heading Rule.** Give each region one clear Chinese heading; do not add an ornamental English word above it merely to manufacture hierarchy.

## Layout

Workspace index routes start with a complete 216px docked directory. Collapsing removes it entirely and returns the full page width; a 32px floating opener restores the same directory as a temporary 216px overlay. There is never an icon-only residual rail. The durable destinations are Home, Projects, Trash, and Settings; project creation is a matte instrument control in the same directory. Project Agent, editor, and preview routes are immersive workbenches and do not render this global directory; they expose one compact return control instead.

Home is composer-first. At desktop widths, the creation composer and the recent-project page stack share the primary split; compact continuation rows sit below. The recent project stack uses real project pages plus quiet structural backplanes in a pointer-driven 3D scene rather than a decorative illustration. At narrower desktop widths, the surfaces stack without hiding the creation action.

Project Agent mode is artifact-first and has no global workspace rail. The conversation dock defaults to 400px and can be resized by pointer or keyboard between 320px and 480px, so the actual renderer remains the dominant stage while users can tune reading width. Conversation history appears through one compact header dropdown; it never becomes a permanent third column or drawer that crushes the preview. Exactly one current Todo is pinned directly above the composer, and its content expands upward while the composer remains fixed. Historical messages remain ordinary transcript messages and never repeat Todo panels.

Desktop acceptance targets are 1440×900, 1920×1080, and 2560×1440. Authoring is desktop-only in V1. At all acceptance widths, horizontal page overflow is forbidden and the real preview must remain wider than the conversation dock.

**The Stable Artifact Rule.** Workspace navigation overlays, dropdown menus, and Todo expansion must not move or resize the artifact unless the user explicitly changes workspace geometry.

## Elevation & Depth

The system is flat by default and separates persistent regions through tone and hairlines. Shadows belong to temporary overlays and the Home project stack; they are structural, not atmospheric. The Agent stage uses a matte frame and calibration corners rather than glass blur or neon bloom.

The Home project stack is the reusable depth signature: a 1200px perspective scene with three preserve-3d layers, a 560ms one-shot spring settle, and pointer-driven `MotionValue` / `useSpring` parallax. Motion changes only transforms and opacity, resets on pointer leave, and resolves immediately when reduced motion is requested. Authentication may use a slower canvas scene, but operational workspaces do not loop decorative animation.

### Shadow Vocabulary

- **Overlay Depth** (`0 18px 48px rgb(0 0 0 / 0.36)`): dropdown menus and workspace navigation overlays only.
- **Front Page Depth** (`0 24px 54px rgb(0 0 0 / 0.32)`): the foremost real project page in the Home stack.

**The Flat-at-Rest Rule.** Persistent panels rely on tonal layering and borders; shadow signals temporary overlap or literal 3D page depth.

## Shapes

Controls use gently calibrated corners: 6px for compact controls, 8px for ordinary controls, 10px for panels, and 12px for floating overlays. Hairlines are 1px. Pills are reserved for compact status or measurement chips; they are not a general container shape.

Stage corners, ruler marks, grids, and resolution readouts may use squared or 2px technical geometry when they represent measurement. Decorative blobs, oversized capsules, and mixed-radius card collections do not belong in the workbench.

## Components

### Buttons

- **Shape:** compact, matte, and explicit (6–8px radius; 28–32px height).
- **Primary:** chalk surface on the deep canvas with dark text; reserve it for the immediate commit or send action.
- **Quiet:** panel background, structural border, and soft ink; use for manual-edit handoff, context, history, and rail creation.
- **Hover / Focus:** one tonal step or border shift over 150–200ms; keyboard focus uses Ice Signal. Never remove the focus ring.

### Cards / Containers

- **Corner Style:** 8–10px with restrained 1px lines.
- **Background:** Matte Panel at rest; Raised Panel for hover, selection, or nested controls.
- **Shadow Strategy:** none for persistent cards; see Elevation for overlays and the project stack.
- **Internal Padding:** 12–24px according to density; avoid multiple nested cards when spacing and a divider are sufficient.

### Inputs / Fields

- **Style:** Matte Panel, Structural Line, 8px corners, 13px body text.
- **Focus:** Ice Signal border or ring without moving the field.
- **Composer:** the input is the bottom-most stable element. Attachments, privacy scope, send, and keyboard hints stay visible.
- **Error / Disabled:** pair semantic color with text and affordance state; never communicate only with color.

### Navigation

- **Docked state:** complete 216px directory on workspace index routes, with names visible and content offset by the same width.
- **Collapsed state:** zero-width navigation with only a 32px floating opener; no icon strip remains.
- **Overlay state:** 216px temporary directory over full-width page content; focus stays inside until it closes.
- **Active state:** one cyan edge marker plus stronger ink, not a filled promotional tile.
- **Shortcut:** Cmd/Ctrl+B toggles expansion; the state is local and reversible.

### Agent Conversation Dock

The dock behaves like a normal coding-Agent conversation: one compact header dropdown for conversation selection, readable user and assistant messages, and no centered `Agent / 手动编辑` segmented switch. `转到手动编辑` is one quiet project action. Technical trace remains collapsed unless requested.

### Todo Execution Panel

Todo is a current execution trace, not a dashboard card or a message type. Exactly one panel stays immediately above the composer; historical messages never render Todo copies. Its four business stages expand upward with `grid-template-rows` and opacity over 200ms using ease-out. The content remains mounted, the composer does not move, and reduced-motion resolves immediately. Verified live measurements are 0px collapsed, about 102.57px at 80ms, and 133px settled for the reference task.

### Artifact Stage

The real `ProjectSchemaRenderer` owns the largest flexible region. A compact toolbar identifies project, draft, context, manual-edit handoff, and full preview. Fit and zoom controls are instrument-like and subordinate to the rendered dashboard. A screenshot may document the design but never replaces the actual renderer in product code.

## Do's and Don'ts

### Do:

- **Do** make the real, editable artifact the largest and clearest region.
- **Do** use one clear Chinese heading and let spacing establish hierarchy.
- **Do** keep a complete 216px directory on workspace index routes, collapse it to zero width with a small temporary opener, and remove it entirely in Agent, editor, and preview workbenches.
- **Do** keep Agent conversation within its 320–480px bounds on acceptance desktops and preserve a wider preview.
- **Do** pin Todo directly above the composer and expand it upward in 160–220ms.
- **Do** provide accessible names, visible keyboard focus, text plus shape for state, and complete `prefers-reduced-motion` behavior.
- **Do** show concrete status: task milestone, revision, verification scope, authorization, and cost when those states exist.

### Don't:

- **Don't** add decorative English eyebrows, AI gradients, robot mascots, magic-wand decoration, or vague “thinking” theater.
- **Don't** restore the centered Agent/manual segmented switch or a permanent conversation-history column.
- **Don't** make the chat wider than necessary or reduce the renderer to a secondary panel.
- **Don't** use white promotional blocks in the rail; creation controls stay matte and instrument-like.
- **Don't** animate continuously in operational workspaces or shift the composer during Todo expansion.
- **Don't** inject product-shell styling into the user's dashboard content.
- **Don't** claim visual completion without checking the actual renderer at the target resolution.
