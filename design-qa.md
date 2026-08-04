# 银行 2022 年度可视化财报大屏 Design QA

## Comparison target

- Source visual truth: `/var/folders/lg/x1gtlwss38910c6w3w43wp6h0000gn/T/codex-clipboard-bd072843-bcc6-4f62-841f-5cd5e57143d5.png`
- Browser-rendered implementation: `/Users/jinso/Study/EasyEditor/EasyDashboard/.tmp/bank-dashboard-v50-canvas.jpg`
- Focused source crop: `/Users/jinso/Study/EasyEditor/EasyDashboard/.tmp/bank-reference-core-cluster.png`
- Focused implementation crop: `/Users/jinso/Study/EasyEditor/EasyDashboard/.tmp/bank-v50-core-cluster.jpg`
- Preview URL: `http://127.0.0.1:5173/projects/cd4b3729-1682-4d80-811d-995d9bacb12a/preview?page=page-home`
- Project: `cd4b3729-1682-4d80-811d-995d9bacb12a`
- Agent conversation: `3yR9EG_8zVKrlfdDzP4F-`
- Draft: `v50`
- State: fit-to-window preview; default `业绩表现` and `浙江` selections; live DateTime, scene entry animation, charts, and rolling tables running.

## Viewport and normalization

- Source pixels: `3456 × 2168` (source aspect ratio about `1.594`).
- Product canvas: fixed `1920 × 1080` CSS px (aspect ratio `1.778`) as required by the EasyDashboard project.
- Chrome viewport: `1728 × 941` CSS px at `devicePixelRatio=2`.
- Rendered canvas box: `1384.89 × 779` CSS px in fit-to-window mode; saved implementation screenshot: `1384 × 779` px.
- The full source and implementation were opened together in one original-detail comparison input. The source file is taller than the required product canvas, so density differences caused only by the fixed 16:9 canvas are treated as a documented product constraint.
- The focused core-competitiveness source and implementation crops were also opened together in one comparison input. The screenshot contains only the dashboard canvas, not browser chrome or preview controls.

## Full-view comparison evidence

- The composition follows the source hierarchy: navy top/bottom rails; open brand/title/live-time header; three KPI cards; full-height shareholder ranking; province map plus gold-bar/red-line chart; merchant table; bottom interest chart, wealth table, dual-ring channel chart, and competency cluster.
- Card surfaces remain flat and report-like, with cool gray-blue, champagne gold, restrained red, white surfaces, and no luminous AI styling.
- The implementation uses editable materials and localized DashboardScene fallbacks instead of using the supplied screenshot as a runtime image.
- The final same-input v50 comparison found no actionable P0, P1, or P2 visual mismatch.

## Focused-region evidence

- Core competitiveness: v49 was compared against the source crop and was found too large and too bright at the outer layers. The Agent-produced v50 crop was then compared against the same source crop. v50 now matches the source-level relative node scale and center hierarchy, while retaining the editable seven-item structure.
- Header: the date and time are real semantic `timer` nodes; time is visually stronger than the date and sits over a faint `2022` watermark.
- Combo map: the right-side tabs and bottom province controls are visible as selected-state buttons; chart legend/curve and map emphasis change independently.
- Dense tables and charts remain readable at the fit-to-window capture. Separate crops were not needed for the remaining regions because their labels, axes, legends, rankings, and markers are legible in the original-detail full comparison.

## Required fidelity surfaces

- Fonts and typography: measured implementation sizes are main title `50px/700`, KPI numerals `42px/700`, ordinary card titles `24px/700`, DashboardScene headings `23px/760`, and shareholder body text `12px/400`. The main hierarchy matches the reference at the fixed 1920×1080 canvas. Remaining heading-weight and small-body differences are P3 refinements, with no clipping or wrapping.
- Spacing and layout rhythm: the four-column macro grid, spanning shareholder card, aligned card edges, compact gutters, and three horizontal content bands preserve the annual-report hierarchy. The v50 cluster no longer overfills its card.
- Colors and visual tokens: the palette maps to pale blue-gray, white, charcoal, slate gray-blue, champagne gold, restrained report red, and positive green. Active tabs, progress tracks, charts, and competency nodes use the same semantic palette.
- Image quality and asset fidelity: the China map uses real GeoJSON, charts are vector/material output, and text remains sharp. The exact proprietary logo/watermark asset was not supplied and was not replaced by a fake screenshot dependency; the editable brand block and restrained document texture preserve its visual role.
- Copy and content: visible Chinese titles, KPI values, shareholder rows, months, legends, percentages, and ranking content are coherent and match the banking-report scenario.
- Icons: gold segmented title markers, ranking crowns, and material-native star ratings are aligned and consistent with the restrained financial-report style.
- Behavior and accessibility: DateTime uses semantic `<time role="timer">`; tabs and province selectors are native buttons with `aria-pressed`; focus, keyboard activation, and reduced-motion styles are implemented in the material layer.

## Interaction and runtime evidence

- Live time advanced from `14:04:39` to `14:04:40` after a one-second wait while the date remained `2026.08.02`.
- Clicking `偿债能力` changed the active button, changed the legend to `流动性覆盖率 / 资本充足率`, and changed the rendered chart path set.
- Clicking `上海` changed the active province while retaining the chosen business tab. Same-coordinate map-region captures changed from SHA-256 `629f4b07e0e33f081b125a273addad53552bcddd2982747338a8c42423f590a7` to `14488ef0aac4f4daaf8204f468daa7d614dd28c4e3d70e956b7b90273592ffd2`, with a visible shift from Zhejiang emphasis to Shanghai/Jiangsu emphasis.
- The final browser state was restored to `业绩表现 + 浙江`.
- Chrome console warnings/errors for the v50 preview: none.

## Comparison history

| Pass | Earlier P0/P1/P2 findings | Fixes made | Post-fix evidence |
| --- | --- | --- | --- |
| v31–v33 | P2: interest chart and several localized custom regions still used weak defaults or overlapping legacy output. | Added localized DashboardScene line capability, rebuilt the interest chart, removed covered legacy output, and improved table density, donut geometry, map scale, title scale, and card shadows. | v33 showed one correct interest chart, rolling tables, map, and dual-ring channel visualization. |
| v35–v40 | P2: KPI microcharts were compressed; map controls occupied the wrong side; capability cluster was too regular; ranking/title emphasis was weak. | Added full-height KPI scenes, moved combo-map controls, calibrated axes and scale, introduced a configurable layered cluster, and added rank/title semantics. | v40 showed visible KPI peaks, colored map, right-side controls, layered cluster, readable headings, and rank icons. |
| v45–v48 | P1 behavior gap: date/time was static and visible controls were not actionable. The Agent could not safely replace a depth-limited scene spec. | Added the first-class DateTime material, native tab/province controls, and safe `props.widgetData` primary-widget override. Registered the capabilities in both hosts and the executor manifest. The Agent then replaced static header texts and configured the existing combo-map without replacing its scene. | Browser evidence shows a ticking timer, chart/legend changes on business tabs, and independent map changes on province buttons. |
| v49 | P2: the enlarged core-competitiveness nodes and default outer layers were too large and visually heavy; a visual reviewer also flagged typography before measurement normalization. | The Agent reduced node sizes, tightened placement, and supplied softer explicit `base/halo/mist` layers. Typography was measured at the actual 1920×1080 product canvas and re-reviewed with the documented source-ratio constraint. | The v50 full-view and focused same-input comparisons report no remaining P0/P1/P2; typography differences are limited to P3. |

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3: the source screenshot is taller than the required 16:9 product canvas, so the implementation is necessarily denser vertically.
- P3: DashboardScene headings are slightly heavier and shareholder body text slightly smaller than the source.
- P3: the v50 competency center and node stagger can still move by a few pixels for literal reference parity, but the scale, overlap, and hierarchy now match.
- P3: the exact proprietary logo and watermark artwork is unavailable; the editable substitute preserves hierarchy but is not an asset-identical reproduction.

## Implementation and regression evidence

- EasyDashboard DateTime + DashboardScene tests: `12 / 12` passed.
- EasyDashboard application TypeScript check: passed.
- Agent DashboardScene quality + ChangeSet model tests: `47 / 47` passed.
- EasyEditor DateTime + DashboardScene + material-manifest probe tests: `12 / 12` passed.
- Document Executor full suite: `30 / 30` passed.
- Relevant EasyDashboard, server, and EasyEditor Biome checks: passed (`12 + 4 + 13` files, no fixes required).
- Both repositories `git diff --check`: passed.
- All project-visible v45–v50 changes were submitted through the EasyDashboard Agent conversation; no direct project schema or database mutation was used.

## Implementation checklist

- [x] Added first-class DateTime material with locale, timezone, format, and update-interval controls.
- [x] Added real tab/province interaction and accessible selected states.
- [x] Added bounded primary-widget data editing so the Agent can configure deep DashboardScene behavior safely.
- [x] Added configurable competency-node geometry and layers, then refined them through the Agent.
- [x] Registered all new material contracts in the visual host and Document Executor manifest.
- [x] Completed full-view and focused-region same-input comparisons after the final visual change.
- [x] Restored the browser to the reference default state and confirmed a clean console.

---

# 全球自然资源数据可视化大屏 Design QA

## Comparison target

- Static layout reference: `/var/folders/lg/x1gtlwss38910c6w3w43wp6h0000gn/T/codex-clipboard-e5c78bbc-ca4d-41ac-a619-aec8bf51a208.png`
- Authoritative Earth and motion reference: `/var/folders/lg/x1gtlwss38910c6w3w43wp6h0000gn/T/codex-clipboard-a5cf3578-f321-4164-aba1-dd51500cdee3.gif`
- Fresh browser implementation: `/tmp/easydashboard-natural-resources-v14.png`
- Same-input comparison: `/tmp/easydashboard-natural-authoritative-comparison-v14.png`
- Preview URL: `http://127.0.0.1:5173/projects/a8a173f6-3534-4a19-a43c-c25a9e7f9c10/preview?page=page-home`
- Project: `a8a173f6-3534-4a19-a43c-c25a9e7f9c10`
- Agent conversation: `jOfT1-XEK5pSlVI2RJ1Os`
- Draft: `v14`

## Final visual evidence

- The final component tree has six Root-level semantic regions: page background, header and live time, central Earth stage, left analysis, right analysis, and bottom metrics. GlobeScene remains the only child of the central stage and keeps its full-stage frame so the galaxy background has no rectangular seam.
- The static reference was used only for composition and module hierarchy; the GIF keyframe was used as the authority for the visible Earth, initial Asia—West Pacific view, relative scale, dark-side lighting, ice-blue atmosphere, star field, and motion intent.
- The final Agent-generated GlobeScene uses `globeScale=0.6`, `surfaceBrightness=0.5`, `ambientLight=0.08`, `daylightIntensity=0.85`, and `lightAzimuth=40`, while preserving five resource markers, a 2.7-second non-looping intro, and `rotationSpeed=0.6`.
- The final same-input review reports no blocking P1. Remaining P2 differences are limited to a slightly restrained bright-side halo and simplified CO2/donut chart ornamentation.
- The right-side DateTime remains a real second-updating timer. All visible content is rendered from editable materials and Div groups; neither supplied reference is used as a runtime screenshot dependency.

## Agent and material hardening

- Added reusable GlobeScene exposure and lighting controls in both the EasyDashboard host and the isolated EasyEditor Document Executor, then exposed them through the strict Agent material catalog.
- Added request-scoped remove authorization: refinement requests and explicit negations no longer expose `remove` in the provider schema, `$defs`, or planner allowlist; explicit delete requests remain supported.
- The final Earth calibration was submitted through the product Agent in natural language and produced draft `v14`; no direct project schema or database mutation was used.

## Verification evidence

- GlobeScene + Agent focused tests: `66 / 66` passed.
- Full Agent and route regression: `282 / 282` passed, `1` environment-gated test skipped.
- Server TypeScript check: passed on Node 22.
- Document Executor production bundle rebuilt and installed into the live local product; full executor regression: `34 / 34` passed.
- Independent visual QA: PASS, no blocking P1.

final result: passed
