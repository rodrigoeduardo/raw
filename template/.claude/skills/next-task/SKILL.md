---
name: next-task
description: Select and claim one eligible board issue, then delegate its implementation to /build-issue. Supports an explicit issue id without changing the single canonical build path.
---

# Next Task (dispatcher)

Select and claim one issue, then delegate implementation to `/build-issue`. **One task per
invocation.** This skill owns work selection; it does not contain a second implementation path.

**REQUIRED READING:** `docs/workflow/board-protocol.md` and `raw.config.yml`. Under a non-GitHub
tracker, read `docs/workflow/adapters/tracker-<provider>.md` and perform equivalent operations.

## Procedure

1. **Service existing obligations first.** For owned open PRs with change requests or requested AI
   review, invoke `/babysit-pr <PR#>` or `/review-pr <PR#>` as appropriate. Do not implement PR
   fixes inside this dispatcher.
2. **Pick.** With no argument, list ready issues and choose the oldest claimable issue according to
   `board-protocol.md`. With `/next-task <explicit-issue>`, fetch only that issue and validate its
   readiness, dependencies, Human actions, holds, and existing claim. Nothing claimable, or three
   or more PRs already in review → report and stop.
3. **Claim.** Atomically move only the selected issue from `status:ready` to
   `status:in-progress` and add the timestamped session claim. A live claim from another session →
   skip (or stop for explicit input); a stale claim follows the documented takeover rule.
4. **Delegate implementation to `/build-issue <issue>`.** Pass the exact selected issue id and any
   run-specific fact the builder cannot derive, then return its status. `/build-issue` owns branch,
   TDD, verification, evidence, PR finalization, and the exact issue's completion transition.
5. Stop after that issue. Never select another issue in the same invocation.

## Red flags — stop

- Implementing code, creating the task branch, or duplicating `/build-issue` instructions here.
- Claiming while owned PR obligations remain unresolved.
- Claiming anything not ready and claimable, or working two issues in one invocation.
- Merging, committing to the integration branch, or recursively invoking `/next-task`.
