# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

EasyDashboard primarily serves individual dashboard implementers, front-end developers, designers, and data practitioners working on desktop who need to turn an incomplete brief, reference image, document, or data sample into a real multi-page big-screen project they can continue editing and deliver.

## Product Purpose

EasyDashboard helps a user create, refine, verify, recover, preview, publish, and share an editable multi-page dashboard. Agent is the default creation and iteration path, while the manual editor remains a peer mode over the same project document. Success is a saved, recoverable, editable, and actually rendered dashboard—not a persuasive chat transcript.

## Positioning

The product joins a normal conversational Agent with staged, observable edits to the same durable dashboard document used by the manual editor, preview, restore history, and publication flow. The artifact, its current revision, and its verification state remain visible while the Agent works.

## Operating Context

- Desktop-first authoring at 1440 × 900, 1920 × 1080, and wider workstations.
- Users start from goals, reference images, files, data samples, or an existing project.
- A project may contain multiple pages, private conversations, shared project context, assets, data connections, draft history, restore points, and published releases.
- Agent work is staged, can pause for material questions or authorization, and can be undone without replacing unrelated later work.
- Manual editing, real preview verification, and explicit publication remain part of the same project lifecycle.

## Capabilities and Constraints

- The existing EasyDashboard project document is the only content model.
- Agent mode and manual editing share one project, draft revision chain, conversation selection, task state, and recovery history.
- The live dashboard preview must receive the dominant workspace area and stay isolated from authenticated product credentials.
- Private conversations belong to their creator; confirmed project context is a separate, reviewable shared resource.
- Internal project edits may continue by default, while external writes, new connections, dependency installation, and publishing require explicit bounded authorization.
- EasyEditor Core remains Agent-free; Agent integration uses host-neutral runtime contracts and semantic capabilities.
- Product chrome must not leak into user-authored dashboard themes.
- V1 is a single-Agent, single-model workflow. It is not a general-purpose Agent, multi-Agent system, website generator, or real-time collaborative editor.
- Mobile authoring is outside V1 scope.

## Brand Commitments

- Keep the `EasyDashboard` name and canonical geometric mark from `src/assets/logo.svg` / `public/logo.svg`.
- Use direct Chinese verbs and concrete nouns for the working interface.
- Do not decorate Chinese headings with redundant English eyebrow labels or generic technical slogans.
- Avoid generic neon-AI gradients, robot or magic-wand motifs, ornamental glass-card grids, and status theater.
- Depth, 3D cues, and motion must explain artifact state, spatial hierarchy, or transitions; they are not ambient spectacle and must respect reduced-motion preferences.

## Evidence on Hand

- Product and workflow truth: `docs/PRODUCT-DESIGN.md`, `docs/AI-AGENT-PLAN.md`, `docs/design/SCREEN-MATRIX.md`, and current runtime tests.
- Visual implementation and tokens: `src/styles/global.css`, `src/layouts/AuthLayout.tsx`, `src/components/calibration-viewport/CalibrationViewport.tsx`, and the canonical logo assets.
- Current Agent surfaces: `src/pages/home/HomePage.tsx` and `src/pages/agent/*`.
- User-provided screenshots document the current density, flatness, persistent navigation, over-wide conversation composition, and unwanted English-label pattern. They are critique evidence, not a visual target.
- No customer claims, benchmark claims, pricing claims, or production usage evidence should be invented.

## Product Principles

1. Artifact over conversation: the dashboard and its real rendered state lead; chat controls the work.
2. Focus before density: reveal navigation, conversations, task detail, and technical trace progressively instead of reserving permanent columns for each.
3. One project, one truth: Agent, manual editor, preview, recovery, and publish operate on the same revision chain.
4. Visible progress without hidden reasoning: show milestones, affected scope, cost, authorization, verification, and recovery—not chain-of-thought.
5. Motion earns its place: use spatial transitions to preserve orientation and make the workspace feel alive without distracting from authoring.

## Accessibility & Inclusion

- All icon-only controls require accessible names and tooltips.
- Task states use text and shape in addition to color.
- Streaming updates use polite live regions and do not steal focus repeatedly.
- Conversation switching, task expansion, composer actions, rail toggles, mode switching, pause, cancel, resume, and undo are keyboard accessible.
- Long Chinese names, URLs, model names, and cost labels wrap or truncate inside their bounds.
- Motion respects `prefers-reduced-motion`, and the interface remains understandable when animation is disabled.
