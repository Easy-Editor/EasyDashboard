# Agent offline evaluation

This evaluation never invokes a model. It scores previously recorded JSON results against the fixed dashboard cases.

```bash
pnpm --dir server exec tsx ../evals/agent/run.mts candidate.json baseline.json
```

Each recording has this shape:

```json
{
  "caseId": "sales-overview",
  "response": {
    "text": "生成销售趋势候选变更",
    "capabilities": ["screen.applyChangeSet"],
    "operations": [{ "opId": "add-sales-chart" }]
  }
}
```

Missing cases score zero. When a baseline is supplied, the runner reports aggregate and per-case deltas.

## Live bank generation benchmark

The bank benchmark is intentionally separate from the recorded contract suite. It performs one real provider call from a blank 1920×1080 project and uses only the text in `cases/bank-financial-report-v1.json`. The deterministic evaluator checks the bank reference composition in addition to widget presence: one emphasized KPI, a tall right shareholder rail, the wide-left map plus middle merchant table, four bottom modules in one row above the bottom band, a light palette, at least seven cluster items, safe-content bounds, motion, overlap, and asset independence.

```bash
pnpm eval:agent:bank
```

The command requires the normal local Agent provider environment and writes a redacted result under `output/evals/bank-financial-report-v1/`. It exits non-zero when the generated `DashboardScene` misses the structural quality bar. It is never run automatically by the offline CI evaluation because it consumes model tokens.

## Live global natural-resources benchmark

`cases/global-natural-resources-v1.json` exercises the multimodal path with a layout reference plus one to three frames extracted from the supplied GIF. The case keeps the existing `id` / `title` / `inputMode` / `canvas` / `prompt` / `qualityBar` contract. Its `qualityBar` is read directly by the case-specific scorer and separates machine-decidable structural and visual hard gates.

```bash
node --env-file-if-exists=.env.local server/node_modules/tsx/dist/cli.mjs \
  evals/agent/run-live-global-natural-resources.mts \
  /path/to/layout.png \
  /path/to/gif-frame-1.png \
  /path/to/gif-frame-2.png
```

Pass PNG, JPEG, or WebP files; extract GIF frames first. The runner accepts two to four references, performs one real vision-capable provider call from a blank 1920×1080 project, and stores only reference names, sizes, media types, and SHA-256 digests in the result artifact. It never writes the image bytes or data URLs to the artifact.

The structural gates require six named regions, editable ordinary materials, exactly one reusable `GlobeScene`, bounded localized `DashboardScene` fallbacks, the expected left/center/right module composition, and no screenshot-backed or full-screen custom shortcut. The visual gates require the dark cyan control-room palette, a live `DateTime`, the TOP5 tracks, land-use cards, resource grid, CO2 needles, life/atmosphere rings, animated numbers and charts, basic interactions, and an Asia-facing globe with stars, atmosphere halo, automatic rotation, and a roughly 2.7-second intro.

The runner writes the hard-gate report under `output/evals/global-natural-resources-v1/` and exits non-zero if any structural, visual, or safety criterion fails. Like the bank benchmark, it is opt-in because it consumes model tokens.
