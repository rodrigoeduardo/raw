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
