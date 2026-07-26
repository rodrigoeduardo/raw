# AI Review Policy

AI review of PRs never runs unrequested. It is triggered by a human, or by the `/autopilot` orchestrator as part of its review→merge loop.

## Triggering

- In a session: `/review-pr <PR#>`, or
- Asynchronously: apply the `ai-review:requested` label — the next dispatcher run (any mode) processes it before claiming new build work.

## What the review does

1. Reads the PR diff, the linked issue's Requirements checklist, the spec sections the issue references (see `specs_dir` in `raw.config.yml`), and `docs/workflow/board-protocol.md`.
2. Posts findings as PR comments (one problem per comment: location, problem, suggested fix).
3. Applies exactly one verdict label and removes `ai-review:requested`:
   - `ai-review:approved` — all acceptance criteria met, no blocking findings;
   - `ai-review:changes-requested` — blocking findings exist (detailed in comments).

Builders treat `ai-review:changes-requested` exactly like human change-requests: addressed before any new work is claimed.

## Findings are input, not verdicts (reconciliation)

A review finding — from raw's reviewer, a review bot, or a human — is a claim about the code, and claims can be confidently wrong. Before a finding turns into work, someone opens the code and confirms it reproduces:

- Under `/autopilot`, the **orchestrator** does this (its step 7b) and dispatches only the confirmed findings; findings that don't reproduce get a reply with the evidence and are recorded as **rebutted**. A later delta re-review treats rebutted findings as closed unless new evidence appears.
- Working by hand, you are that step: reproduce before you fix. Changing correct code to satisfy an invalid comment is a regression that passes review.

Ambiguous, conflicting, or scope-expanding feedback is neither fixed nor dismissed — it's escalated to a human with the competing options, and the thread stays open.

**Green CI is not the whole gate.** Feedback can arrive after checks go green without changing the commit SHA, so "ready to merge" is revoked by any untriaged comment, review, or inline thread on the PR.

## Evidence gate (user-visible work)

A green test proves the logic ran. It does not prove anything rendered — a feature can be invisible on screen with its whole suite passing, because the test exercised the logic and nobody ever looked at the app. So for user-visible work, "done" requires an artifact **someone other than the author looked at**.

Configured by `raw.config.yml` → `evidence.ui_screenshot`:

| Value | Behavior |
|---|---|
| `auto` (default) | Required whenever the issue is user-visible — the template's `**User-visible:** yes` field, or a UI-ish `area:*` label. Inert everywhere else, so headless repos are unaffected. |
| `required` | Required on every PR. |
| `off` | Never required. |

When the gate is active:

1. The **builder** runs the real app (`commands.dev`), drives the actual flow at a reasonable viewport, screenshots it, and attaches the image to the PR under "Requirements coverage".
2. The **reviewer** opens the artifact and checks it shows the claimed behavior, *before* setting a verdict. That second look is the whole point — "a screenshot exists" is not the gate, "someone besides the worker looked" is.
3. No artifact on a gated PR → `ai-review:changes-requested`. Do not approve on the promise of one.

**`commands.dev` unset while the gate is active on an issue → the builder reports `BLOCKED`.** Silently skipping the gate is not an option: that is exactly the failure the gate exists to catch. Fix the config (`/configure`), or set `evidence.ui_screenshot: off` deliberately.

## Adversarial reviewer (optional second channel)

`runners.adversarial_reviewer` (off by default) runs a second reviewer from a **different model family** over the same diff — errors from two families are less correlated than two runs of the same one, so it catches things raw's reviewer is systematically blind to.

- Its findings are **PR comments only**. It never sets a verdict label.
- Raw's reviewer's `ai-review:*` label remains THE verdict.
- Its findings flow through the same reconciliation path as everyone else's: verified against the code before they become work, rebutted with evidence when they don't reproduce.

## Supplement vs replace (human-toggled, per PR)

| Mode | How | Meaning |
|---|---|---|
| **Supplement** (default) | just `ai-review:requested` | AI verdict is advisory. A human still reads the diff before merging. |
| **Replace** | human applies `ai-review:final` **before or with** the request | If the verdict is `ai-review:approved`, the human may merge without reading the diff. |

`ai-review:final` is meaningful only when applied by the human. Agents never apply or remove it.

## Relation to the merge gate

The verdict label is input to the merge gate (`gates.merge` in `raw.config.yml`), it is not the gate itself:

- `gates.merge: human` — a person clicks merge, using the AI verdict per the table above.
- `gates.merge: auto` — `/autopilot` merges only on `ai-review:approved` + green CI + mergeable (see the autopilot skill's merge-gate checklist). The review verdict alone never merges anything.
