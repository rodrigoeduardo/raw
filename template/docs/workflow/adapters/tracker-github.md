# Adapter — tracker: github (default)

Active when `raw.config.yml` → `tracker.provider` is `github` (or unset). The board is GitHub Issues
on this repo; **labels are the state**. Everything below is the concrete spelling of the operations
in [`../board-protocol.md`](../board-protocol.md).

Derive owner/repo at runtime — never hardcode:

```bash
gh repo view --json owner,name,defaultBranchRef
```

## State

One `status:*` label per open issue (`proposed`, `ready`, `in-progress`, `in-review`, `blocked`); a
closed issue is done. Plus `area:*`, `human-action-needed`, `auto:hold`. `/configure` creates them.

## Operations

| Operation | Command |
|---|---|
| List candidates | `gh issue list --label "status:ready" --state open --json number,title,body,labels,createdAt` |
| Read one issue | `gh issue view <n> --json number,title,body,labels,comments` |
| Transition state | `gh issue edit <n> --remove-label "status:<from>" --add-label "status:<to>"` |
| Claim | transition to `status:in-progress` **plus** `gh issue comment <n> --body "Claimed by <session-id> at $(date -u +%Y-%m-%dT%H:%M:%SZ)"` |
| Block | transition to `status:blocked` + comment stating exactly what is needed |
| Send back for rewrite | transition to `status:proposed` + comment `needs rewrite: <what was ambiguous>` |
| Create (planner) | `gh issue create --title ... --label "status:proposed" --label "area:<x>" --body-file <file>` |
| Close | automatic on merge via `Closes #N` in the PR body |
| Dependencies | `Depends on #N` lines in the issue body, one per line — parsed by the dispatcher |
| Hold | `auto:hold` label |
| Abort marker | an open issue titled exactly `AUTO-STOP` |

## Dependencies

GitHub has no native blocker relation, so `Depends on #N` **body lines are the graph**. Rules:

- one dependency per line, exact form `Depends on #N`;
- a dependency is satisfied when issue `#N` is **closed**;
- never infer a dependency from titles, areas, or similarity — unstated means independent;
- a `#N` that can't be read (other repo, deleted) is an **external blocker**: the dependent is not
  claimable and is reported as "blocked externally by #N".

## Concurrency

The timestamped claim comment is the only lock. A second dispatcher skips issues with a live claim
comment; a claim older than 24h with no pushes to the task branch may be taken over with a comment.

## Notes

- Label writes are cheap and atomic; do them one operation at a time so a crash leaves a legible
  half-state (an issue with no `status:*` label is a visible anomaly, not a silent one).
- `pr-merged-cleanup.yml` strips `status:in-review` when the PR merges, so the merge itself is the
  only write needed at that point.
