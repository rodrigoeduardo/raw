# Agentic Workflow Diagram Design

**Status:** Approved design

**Goal:** Update the README workflow diagram so it accurately explains the bounded execution and conditional PR-reconciliation architecture introduced on this branch.

## Design

Use a compact architecture/flow diagram with three context boundaries:

1. **Board context** — `AUTOPILOT / NEXT-TASK` selects and claims exactly one ready issue.
2. **Issue context** — `AUTO-EXECUTOR` invokes `/BUILD-ISSUE` for one claimed issue, including targeted TDD, verification, and bounded CLI evidence. The runner note identifies Claude and Codex as supported execution engines.
3. **PR context** — `AUTO-BABYSITTER` owns mechanical CI, status, and feedback-fingerprint checks and dispatches the independent reviewer. It stops at merge-ready; the orchestrator owns the merge and deploy gates.

The normal path is solid and flows from selection through issue execution, review, babysitting, merge-ready, merge, and deploy. The conditional path is dashed: substantive blocking findings go from the babysitter to one bounded `AUTO-RECONCILER`; confirmed findings dispatch one targeted FIX executor and return to the PR loop. No findings bypass reconciliation and remain merge-ready. A footer explains the solid/dashed semantics and the one-issue/one-executor boundary.

## Asset and README changes

- Replace `docs/assets/raw-workflow.excalidraw` with the matching Excalidraw source, keeping all text at `fontFamily: 5`, unique element IDs, readable spacing, and a small element count.
- Update `docs/assets/raw-workflow-light.svg` and `docs/assets/raw-workflow-dark.svg` to be visually identical to the source diagram for GitHub README rendering.
- Update the README image alt text and caption so they describe the three context boundaries, the conditional reconciler, and the configurable merge/deploy handoff.

## Constraints and validation

- Preserve the existing light/dark `<picture>` presentation and source-file link.
- Do not change workflow implementation files or add generated/install output.
- Do not include the unrelated untracked `raw-refactor.md`.
- Validate the Excalidraw asset as JSON, verify unique IDs and `fontFamily: 5` on every text element, check SVG presence and matching key labels, and confirm README links resolve to tracked assets.
