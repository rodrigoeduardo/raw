---
name: babysit-pr
description: Use to keep one pull request green and moving — triage its CI, reconcile review findings against the code, fix what's real, and take it to merge-ready. Invoke as /babysit-pr <PR#>. One PR per invocation; merges only if gates.merge is auto.
---

# Babysit PR

Drive **one** PR from wherever it is to merge-ready: CI triaged, every finding reconciled and either
fixed or rebutted, feedback triaged, checklist satisfied. One PR per invocation.

**REQUIRED READING:** `docs/workflow/pr-babysit.md` (the procedure — this skill is its
single-PR entry point), `docs/workflow/review-policy.md`, `docs/workflow/git-conventions.md`.
Read `raw.config.yml` for `commands`, `gates.merge`, `autopilot.max_fix_cycles`, `runners`.

Use this when a PR needs attention on its own: a human PR that went red, a PR left behind by a
crashed run, one you don't want to spin up the whole board for. `/autopilot` runs the same procedure
inline for every PR it owns — don't run both on the same PR at once.

## Procedure

1. **Load the PR.** `gh pr view <p> --json number,title,body,headRefName,headRefOid,isDraft,labels,mergeable,mergeStateStatus`.
   Draft → say so and stop unless the human asked you to finish it. `auto:hold` → stop.
   Find its issue via `Closes #N` — the acceptance criteria are the definition of "correct" here.

2. **Scope check** (pr-babysit.md §0) — right base, right head, files in scope. Drift → fix reason.

3. **CI triage** (§1) — key by branch + head SHA + conclusion; **CANCELLED ≠ FAIL** (check for a
   newer commit with a run in progress before treating red as red); get the real failure with
   `gh run view <id> --log-failed`.

4. **Feedback fingerprint** (§2) — hash comments + reviews + inline threads. A fingerprint you
   haven't triaged means the PR is not ready, whatever the labels say.

5. **Reconcile** (§3) — for each blocking finding, open the code and confirm it reproduces **before**
   changing anything. Reproduces → fix it. Doesn't → reply with the evidence and leave the code
   alone. Ambiguous / scope-expanding → escalate to the human, leave the thread open.

6. **Fix** (§4) — confirmed reasons only. Two ways, pick one and say which:
   - **Inline** (default for a small, obvious fix): do it here, TDD when a finding names untested
     behavior, atomic commits, push. Never force-push, never commit to the default branch.
   - **Dispatch** (bigger fix, or you want isolation): dispatch an `auto-executor` in mode FIX with
     the PR number, branch, and **only the confirmed findings** — same as autopilot does.
   Then re-request review if the PR is under AI review: `gh pr edit <p> --add-label "ai-review:requested"`.
   Stop after `autopilot.max_fix_cycles` rounds — label the issue `status:blocked`, comment what
   remains, and apply the two-strikes rule (board-protocol.md) if this is its second failure.

7. **Merge-ready checklist** (§5) — approved (or trivially skipped), all checks green on the current
   SHA, mergeable and not behind the default branch, fingerprint triaged, evidence gate satisfied
   for user-visible work.
   - `gates.merge: auto` → `gh pr merge <p> --squash` (never `--delete-branch`).
   - `gates.merge: human` → report "ready to merge" and stop. **Never merge.**

8. **Report**: what CI said and what it actually was, findings fixed vs **rebutted** (with the
   evidence), threads escalated, rounds used, final state, and the PR's "Human actions needed"
   section if it merged.

## Red flags — stop

- Merging with `gates.merge: human`, on red/pending CI, with conflicts, or with untriaged feedback.
- Changing correct code to satisfy a finding you never reproduced.
- Force-pushing, committing to the default branch, or deleting a branch.
- Working a second PR in the same invocation.
- Expanding the diff beyond the issue's scope because a comment suggested it.
- Running on a PR `/autopilot` is currently driving.
