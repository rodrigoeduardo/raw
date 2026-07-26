---
name: babysit-pr
description: Use to keep one pull request green and moving — triage its CI, reconcile review findings against the code, fix what's real, and take it to merge-ready. Invoke as /babysit-pr <PR#>. One PR per invocation; merges only when invoked by a human and gates.merge is auto.
---

# Babysit PR

Drive **one** PR from wherever it is to merge-ready: CI triaged, every finding reconciled and either
fixed or rebutted, feedback triaged, checklist satisfied. One PR per invocation.

**REQUIRED READING:** `docs/workflow/pr-babysit.md` (the procedure — this skill is its
single-PR entry point), `docs/workflow/review-policy.md`, `docs/workflow/git-conventions.md`.
Read `raw.config.yml` for `commands`, `gates.merge`, `autopilot.max_fix_cycles`, `runners`.

## Mode

- **`interactive`** (default — a human typed `/babysit-pr <PR#>`). Step 7 merges per `gates.merge`.
  Use this when a PR needs attention on its own: a human PR that went red, a PR left behind by a
  crashed run, one you don't want to spin up the whole board for.
- **`dispatched`** (`--mode dispatched` — you are an `auto-babysitter` spawned by `/autopilot`).
  Step 7 reports and stops. **Never merge**, whatever `gates.merge` says: the orchestrator
  serializes merges because each one changes the default branch it re-derives the frontier from.

`/autopilot` drives every PR it owns through this same skill, one `auto-babysitter` per PR — so
don't run `/babysit-pr` by hand on a PR an autopilot run is currently holding.

## Procedure

1. **Load the PR.** `gh pr view <p> --json number,title,body,headRefName,headRefOid,isDraft,labels,mergeable,mergeStateStatus`.
   Draft → say so and stop unless the human asked you to finish it. `auto:hold` → stop.
   Find its issue via `Closes #N` — the acceptance criteria are the definition of "correct" here.

2. **Scope check, then triviality** (pr-babysit.md §0) — right base, right head, files in scope.
   Drift → fix reason. Then decide whether the diff is worth a review at all; a skipped PR is
   recorded `review=skipped-trivial` and needs green CI alone to clear the review half of step 7.

3. **CI triage** (§1) — key by branch + head SHA + conclusion; **CANCELLED ≠ FAIL** (check for a
   newer commit with a run in progress before treating red as red); get the real failure with
   `gh run view <id> --log-failed`. Read CI — never run the project's suite yourself to find out
   what it says.

4. **Feedback fingerprint** (§2) — hash comments + reviews + inline threads. A fingerprint you
   haven't triaged means the PR is not ready, whatever the labels say.

5. **Reconcile** (§3) — for each blocking finding, open the code and confirm it reproduces **before**
   changing anything. Reproduces → fix it. Doesn't → reply with the evidence and leave the code
   alone. Ambiguous / scope-expanding → escalate to the human, leave the thread open.

6. **Fix** (§4) — confirmed reasons only. Two ways, pick one and say which:
   - **Inline** — only when the fix fits **all** of: one file, no new test needed, no dependency
     or config change, no change to a public interface. Do it here: atomic commits, push. Never
     force-push, never commit to the default branch. Run the worktree preflight
     (`commands.install`, env check) only on this path — the read-only steps above don't need it.
   - **Dispatch** — everything else, including anything that needs a regression test. Dispatch an
     `auto-executor` in mode FIX with the PR number, branch, and **only the confirmed findings**;
     it runs TDD and its own preflight in its own worktree.

   The ceiling is deliberate. Fixing inline saves a worktree provision and a cold start, which is
   real latency — but it does the work at the orchestration tier's model rather than the executor's,
   so it stops paying off the moment the fix is more than a small edit. When in doubt, dispatch.

   Then re-request review if the PR is under AI review: `gh pr edit <p> --add-label "ai-review:requested"`.
   A re-review is a **delta**: pass the reviewer the last reviewed SHA, the previous round's
   blocking findings, and the findings you **rebutted**, so it doesn't re-raise them without new
   evidence.
   Stop after `autopilot.max_fix_cycles` rounds — label the issue `status:blocked`, comment what
   remains, and apply the two-strikes rule (board-protocol.md) if this is its second failure.

7. **Merge-ready checklist** (§5) — approved (or trivially skipped), all checks green on the current
   SHA, mergeable and not behind the default branch, fingerprint triaged, evidence gate satisfied
   for user-visible work. The evidence gate is the reviewer's to enforce — confirm it via the
   `ai-review:approved` label, don't re-open the screenshot.
   - `dispatched` → report `MERGE_READY` and stop. **Never merge.**
   - `interactive` + `gates.merge: auto` → `gh pr merge <p> --squash` (never `--delete-branch`).
   - `interactive` + `gates.merge: human` → report "ready to merge" and stop. **Never merge.**

8. **Report**: what CI said and what it actually was, findings fixed vs **rebutted** (with the
   evidence), threads escalated, rounds used, whether each fix was inline or dispatched, final
   state, and the PR's "Human actions needed" section if it merged. Dispatched mode ends on the
   status line in `.claude/agents/auto-babysitter.md` — keep the detail on the PR, not in the reply.

## Red flags — stop

- Merging in `dispatched` mode, or with `gates.merge: human`, or on red/pending CI, with conflicts,
  or with untriaged feedback.
- Changing correct code to satisfy a finding you never reproduced.
- Running the project's test or lint commands to establish CI state — read `gh pr checks`.
- Re-opening the evidence screenshot the reviewer already checked.
- Fixing inline past the ceiling in step 6 instead of dispatching.
- Force-pushing, committing to the default branch, or deleting a branch.
- Working a second PR in the same invocation.
- Expanding the diff beyond the issue's scope because a comment suggested it.
- Running on a PR an `/autopilot` run is currently driving.
