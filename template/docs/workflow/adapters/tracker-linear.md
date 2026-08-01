# Adapter — tracker: linear

Active when `raw.config.yml` → `tracker.provider` is `linear`. The board is a Linear team's issues;
**Linear workflow state is the state**. Everything else in
[`../board-protocol.md`](../board-protocol.md) is unchanged — including the whole review pipeline,
because **PRs are always GitHub** and `ai-review:*` stay GitHub PR labels.

**Prerequisite:** the Linear MCP server, reachable in the session (`/configure` checks this). All
reads/writes below go through it — never scrape the Linear web UI.

## Config

```yaml
tracker:
  provider: linear
  linear:
    team: ENG
    states:
      proposed: Backlog
      ready: Todo
      in_progress: In Progress
      in_review: In Review
      blocked: Blocked
```

The `states` map is required: raw's five statuses are the protocol, your Linear workflow states are
the spelling. If your team has no "Blocked" state, either create one (`/configure` offers to) or
leave `blocked:` unset and raw falls back to a `raw:blocked` **Linear label** applied on top of the
current state.

## Operations

| Operation | Linear |
|---|---|
| List candidates | `list_issues` for `team`, filtered to the state mapped from `ready` |
| Read one issue | `get_issue` with `includeRelations: true` |
| Transition state | `update_issue` → the state mapped from the target status |
| Claim | transition to `in_progress` **plus** a comment `Claimed by <session-id> at <ISO timestamp>` (same backstop as GitHub — assignee alone is not a claim) |
| Block | transition to `blocked` (or apply `raw:blocked`) + comment what is needed |
| Send back for rewrite | transition to `proposed` + comment `needs rewrite: <what was ambiguous>` |
| Create (planner) | `create_issue` in `team`, state = `proposed`, labels = `area:*` |
| Dependencies | native **`blockedBy` relations** — read via `get_issue … includeRelations: true` |
| Human action pending | Linear label `human-action-needed` |
| Hold | Linear label `auto:hold` |
| Abort marker | an open Linear issue titled exactly `AUTO-STOP` in the team |
| Close on merge | Linear's GitHub integration (see below) |

## Dependencies — relations, not body text

Linear has real relations, and they are strictly better than parsing prose: **read `blockedBy`, and
ignore any `Depends on` text in the body.** A `blockedBy` target that is Done/merged counts as
satisfied; still-open counts as blocking.

Relations can point outside the team or project. An open blocker that isn't in your candidate set is
an **external blocker**: the dependent gets no wave number, is never claimed, and is reported as
"blocked externally by `<ISSUE-ID>`".

## Close-on-merge

Who moves the issue to Done on merge is set by `tracker.linear.close_on_merge` (default
`integration`):

- **`integration`** — Linear's native GitHub integration does it. Keep the two hooks it needs:
  - branch naming embeds the Linear id — `feat/ENG-123-user-signup-form` (the `type/<id>-<slug>`
    rule in `../git-conventions.md`, with the Linear id as the id);
  - the PR body says `Fixes ENG-123` in addition to the usual summary.

  The orchestrator only *verifies* the move afterward.
- **`manual`** — the integration is **not** installed, so the orchestrator transitions the issue to
  the `done`/completed state itself on the merge event (`update_issue`) and **skips the "did it
  move?" probe**. Set this to save a wasted round-trip per merge when you already know the
  integration is absent: keep `Fixes ENG-123` in the PR body regardless (harmless, and it's what
  makes the switch back to `integration` free later).

> Detecting which you have: merge a PR and look at the issue. If it stays in the `in_review` state,
> the integration is not moving it — set `close_on_merge: manual`. (Every merge in this repo's first
> autopilot run left the issue in "In Review" until the orchestrator moved it — hence `manual` here.)

## What does NOT change

- **`ai-review:*` labels stay on the GitHub PR.** `../review-policy.md` is tracker-independent; do
  not mirror review verdicts into Linear.
- Gates, the two-strikes rule, reconciliation, the evidence gate: identical.
- The claim comment is still the concurrency backstop.

## Gotchas

- **Assignee ≠ claim.** Linear assignment is a human convention; the claim comment is what a second
  dispatcher reads. Set both if you like, trust the comment.
- **State names are per-team strings.** A renamed state silently breaks the mapping — re-run
  `/configure` after workflow edits.
- **Two sources of "done".** If the GitHub integration is active, do not also transition on merge:
  you will fight it. Pick one and record which in the config comment.
