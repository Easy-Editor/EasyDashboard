# EasyDashboard Design Workspace

This directory replaces Figma as the working source for the current
EasyDashboard product redesign.

It is intentionally code-native:

- Markdown records decisions, behavior, and state coverage;
- HTML makes the visual direction directly inspectable;
- Git records every change;
- the implementation can be compared against the same tokens and examples.

## Source-of-truth order

Different questions have different authorities:

1. Existing tests and runtime behavior define what the product currently does.
2. [`../PRODUCT-DESIGN.md`](../PRODUCT-DESIGN.md) defines approved product and
   visual decisions.
3. [`SCREEN-MATRIX.md`](./SCREEN-MATRIX.md) defines required screens and states.
4. [`foundations.html`](./foundations.html) is the visual calibration target.
5. Application code implements the target and must be verified in a real
   browser.

When these disagree, do not silently choose one. Record the mismatch and decide
whether it is a product change, a design correction, or an implementation bug.

## View the visual reference

From the `EasyDashboard` directory:

```bash
python3 -m http.server 4178 -d .
```

Then open:

```text
http://localhost:4178/docs/design/foundations.html
```

The page is standalone and has no package or build dependency. It loads the
actual product logo and bundled Alibaba fonts from this repository.

## Artifact status

| Artifact | Status | Purpose |
| --- | --- | --- |
| Product design | Phase 0 approved | product core and visual contract |
| Screen matrix | Active | desktop page and state coverage |
| Visual foundations | Active | inspectable calibration boards |
| Components | Runtime baseline active | shared shell and core editor geometry use Phase 0 tokens |
| Key-screen prototypes | Runtime baseline active | authentication, project space, editor, preview, and publishing are implemented |
| Runtime implementation | Active | converge remaining states and verify them in a real browser |

## Review rules

- Review desktop at 1440 x 900 and 1920 x 1080.
- Use real Chinese labels and believable project metadata.
- Treat the editor as the primary screen.
- Keep one project visibly multi-page.
- Keep product chrome separate from user screen themes.
- Compare actual screenshots, not only CSS values.
- Add a state to `SCREEN-MATRIX.md` before implementing a new interaction.
- Do not add Agent, templates, mobile, or team concepts to the core flow without
  updating the product contract first.

## Figma note

The EE Figma file contains an initial Phase 1 token pass created on 2026-07-30.
The connected account is on a Starter plan and cannot support the required MCP
workflow without a paid upgrade, so Figma is not the authoritative working
surface for this phase. The repository artifacts above remain usable without
that dependency.
