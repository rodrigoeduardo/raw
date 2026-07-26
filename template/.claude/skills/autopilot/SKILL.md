---
name: autopilot
description: Use to run the board autonomously — claim every ready+claimable issue, build it, AI-review it, and (per configured gates) merge and deploy. Orchestrator only; spawns auto-executor and auto-babysitter sub-agents. Invoke explicitly (/autopilot); never self-trigger.
---

# Autopilot (autonomous dispatcher)

Drain the board: claim ready+claimable issues, spawn workers to build them, spawn a babysitter to
drive each PR to merge-ready, then merge and deploy **as far as the configured gates allow**. You
are the orchestrator — you coordinate; you do **not** write code, review diffs, or triage PRs
yourself.

**REQUIRED READING:** `docs/workflow/board-protocol.md`, `git-conventions.md`, `review-policy.md`.

## Step 0 — read config

Read `raw.config.yml` (missing file/keys = documented defaults). You care about:

- `gates.promote` (`human` default): `auto` lets you promote qualifying `status:proposed` issues.
- `gates.merge` (`human` default): `auto` lets you merge PRs that pass the merge-gate checklist.
  `human` → you stop each PR at "approved + green", label state speaks for itself, and your run
  summary lists PRs ready for a human merge.
- `gates.deploy` (`human` default) + `commands.deploy`: whether/how you deploy after merges.
- `autopilot.parallel` (default 1), `autopilot.max_fix_cycles` (default 3).
- `tracker.provider` (default `github`), `worktrees.provider` (default `claude`), `runners.*`
  (executor/reviewer default claude/sonnet, babysitter claude/opus), `evidence.ui_screenshot`
  (default `auto`) + `evidence.driver` (default `playwright`) + `commands.dev`.

**Adapters.** Every board operation below is written in GitHub terms because that is the default.
If `tracker.provider` is not `github`, read `docs/workflow/adapters/tracker-<provider>.md` first and
perform the equivalent operation there — the protocol (states, claims, dependencies, gates) is
identical, only the spelling changes; PRs and `ai-review:*` labels stay on GitHub either way.
Likewise, dispatch below says "dispatch an `auto-executor`/`auto-babysitter`", which is the
`worktrees.provider: claude` + `runners.*.runner: claude` path; any other combination follows
`docs/workflow/adapters/worktrees-<provider>.md` and `.../runner-<runner>.md`, which define how the worker is
launched and how its result comes back. The decision logic in this skill never changes with either.

Tiered review cost is handled inside the babysit procedure, not here: trivial PRs skip AI review
entirely and fix-cycle re-reviews are delta-only. Neither changes what a full first review of
substantive code checks — they only cut redundant re-checking.

## Run this on the right session

- **Main (this) agent:** pure bookkeeping — labels, dispatch, the wave table, the merge gate, the
  run summary. You never read a diff, a CI log, or a review thread; the babysitter does that in its
  own context and hands you back a status line. That keeps this session **board-scoped**: it grows
  with the size of the board, not with the volume of PR traffic, so a long board no longer forces a
  restart mid-run. If you do find yourself pulling PR detail in here, that is the signal something
  belongs in the babysitter instead.
- **Workers:** you dispatch `auto-executor` (mode BUILD) and `auto-babysitter`; the babysitter
  dispatches `auto-reviewer` and its own `auto-executor` (mode FIX). See `.claude/agents/`. The
  babysitter is the one that needs a capable model — it decides whether a review finding is real
  or a confident hallucination.
- **Do not** run this alongside a `/loop /next-task` session or a scheduled dispatcher (they share
  the claim-comment backstop and will collide). One autonomous dispatcher at a time.

## Setup (once per repo)

`gh label create auto:hold --description "autopilot: skip this issue/PR" 2>/dev/null || true`.
STOP marker convention: an open issue whose title is exactly `AUTO-STOP`. Its presence aborts runs.

## Procedure

1. **Abort check.** `gh issue list --search "AUTO-STOP in:title" --state open` → if found, print
   "STOP marker present — aborting" and stop. Record your session-id for claim comments.

2. **Adopt open PRs first** (service obligations before new work). For every open PR, drive it
   through steps 6–8 before claiming any new issue. This clears PRs left by prior runs or humans.
   Skip any PR labeled `auto:hold`.

3. **Build the dependency graph, print the wave table, derive the claimable frontier.**
   ```bash
   gh issue list --state open --limit 200 --json number,title,body,labels,createdAt
   ```

   **Graph.** Edges come **only** from `Depends on #N` lines in issue bodies — never inferred from
   titles, areas, or similarity. A blocker that is **closed** counts as satisfied (wave 0). A
   blocker that doesn't exist / can't be read is an external blocker: leave the dependent unscheduled
   and report it as "blocked externally by #N".

   **Waves.** `wave(issue) = max(wave of its open blockers) + 1`; an issue with no open blockers is
   wave 1. Print this at run start, and re-derive it after every merge (step 9):

   | Wave | Issues | Unblocks |
   |---|---|---|
   | 1 | #12, #14 | #18, #21 |

   Call out fan-in issues (2+ blockers) and any issue whose "Rollout & observability" introduces an
   OFF-by-default flag — that flag is what lets its PR merge without changing behavior. Surface the
   flip in the run summary; never flip it yourself.

   **The wave table is reporting and ordering, not scheduling.** You do not run waves as batches —
   batching is a snapshot that goes stale the moment a human edits the board mid-run. You schedule
   from the **claimable frontier**, re-derived from the tracker on every pass.

   **Frontier.** Keep an issue only if: labeled `status:ready`; every `Depends on #N` points to a
   **closed** issue; "Human actions" is "None" or fully checked (no `human-action-needed` label); it
   is **not** labeled `auto:hold`; and it has no live claim comment from another session. Order by
   **most dependents unblocked first**, then oldest.
   Empty frontier: if `gates.promote` is `auto`, you may promote `status:proposed` issues that have
   verifiable acceptance criteria, "Human actions" = "None", and no `auto:hold` — then rebuild it.
   Still empty and no open PRs left → go to step 10.

4. **Claim** the next issue from the frontier (or, with `autopilot.parallel` > 1, the next N from the
   frontier — never ones that share obvious files; file overlap is a secondary filter on top of the
   frontier, not a substitute for it):
   ```bash
   gh issue edit <n> --remove-label "status:ready" --add-label "status:in-progress"
   gh issue comment <n> --body "Claimed by <session-id> at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
   ```
   A fresh claim comment from another session → skip. Stale (>24h, no branch pushes) → comment a
   takeover, then claim.

5. **Build.** Dispatch an `auto-executor` (mode BUILD) per claimed issue.
   - Sequential (parallel=1, default): one dispatch, wait for its status line, then continue.
   - parallel>1: issue N dispatches in one turn; each gets its own worktree.
   - **Blocker merged this run** → say so explicitly in the dispatch: "the default branch already
     contains `<what>` from #N — REUSE it, do not reimplement." Each executor branches off the fresh
     default branch (git-conventions.md), so the code is there; without the pointer the worker often
     rebuilds it and the PR grows a conflicting duplicate.
   On `BLOCKED`/`TOO_BIG` → the worker already labeled the issue; record it and move on. `BLOCKED`
   → check the two-strikes rule (step 7).
   On `DONE pr=#<p>` → hand that PR to a babysitter (step 6).

6. **Drive the PR — dispatch a babysitter.** One `auto-babysitter` per PR. It runs
   `docs/workflow/pr-babysit.md` end to end in its own context: scope check, trivial-skip decision,
   CI triage, feedback fingerprint, finding reconciliation, and the fix loop (dispatching its own
   `auto-executor` in mode FIX, or fixing inline under the ceiling in the `babysit-pr` skill). It
   stops at the merge-ready checklist and reports.

   Pass it the PR number and any run-specific fact it can't read off the board — most often
   "the default branch already contains `<what>` from #N". Everything else it reads from the docs
   and the PR itself.

   **Do not** inspect the PR here first. The scope and triviality checks are the babysitter's §0,
   and duplicating them just pulls PR detail into this session — the exact thing this split exists
   to prevent.

   **Adversarial reviewer** (only if `runners.adversarial_reviewer` is set): the babysitter
   dispatches it alongside the first review, per `docs/workflow/adapters/runner-<runner>.md`. It
   posts findings as PR comments and **sets no label** — raw's reviewer still owns the verdict, and
   its findings go through the same reconciliation as everyone else's.

7. **React to the status line.** The babysitter caps its own fix rounds at
   `autopilot.max_fix_cycles` and derives the round count from the PR timeline, so a restarted run
   resumes correctly.

   - `MERGE_READY pr=#<p> …` → go to the merge gate (step 8). Record `rounds` and `rebutted` for
     the run summary; note `review=skipped-trivial` if present.
   - `BLOCKED pr=#<p> …` → it already labeled the **issue** `status:blocked` and left the PR and
     branch untouched for a human. Then apply the **two-strikes rule** (board-protocol.md): if this
     issue's timeline shows it has now hit `status:blocked` for the **second** time on an execution
     failure (not a launch/infra error), do not leave it to be relaunched — relabel it
     `status:proposed` and comment `needs rewrite: <what was ambiguous>` so `/plan-board` picks it
     up as a rewrite. Record it in the run summary as a spec defect, not as a blocked task.
   - `ESCALATE pr=#<p> …` → an ambiguous or scope-expanding thread needs a human. Leave the PR
     alone and carry the reason into the run summary. Never resolve it by dispatching a fix.

   A babysitter that dies without a status line is a launch failure, not an execution failure —
   re-dispatch it once (it re-derives everything from the PR) before treating the PR as blocked,
   and don't count it against the two-strikes rule.

8. **Merge gate.** `MERGE_READY` already asserts the four checks the babysitter owns — verdict (or
   trivial skip), green CI on the head SHA, a triaged feedback fingerprint, and the evidence gate.
   **Don't re-verify those**; it re-reads the PR into this session for a second opinion you have no
   more information to form.

   Re-check the one thing that goes stale *because of you*: merges you performed since the
   babysitter looked.

   - PR **mergeable**, not behind the default branch
     (`gh pr view <p> --json mergeable,mergeStateStatus`).
   - Behind or conflicted → re-dispatch the babysitter with that as the reason; it counts against
     its cap.
   - If the babysitter reported checks still running, don't poll in a loop: run
     `gh pr checks <p> --watch --fail-fast` as a single **background** command with a ~10 min
     timeout, and continue other bookkeeping (re-derive the frontier, adopt other open PRs) while
     it runs. Still pending or timed out → not ready, revisit next pass.

   Then, per `gates.merge`:
   - `auto`:
     ```bash
     gh pr merge <p> --squash          # NO --delete-branch
     ```
     Merge auto-closes the issue via `Closes #N`; `pr-merged-cleanup.yml` strips `status:in-review`.
   - `human`: record the PR as **ready to merge** in the run summary and move on — never merge.

   **Harvest human follow-ups.** Whenever a PR merges (yours or one that merged during the run),
   read its **"Human actions needed"** section and collect it into the run summary — backfills to
   run, flags to flip, secrets/env to set, docs to sync. Surface, don't auto-do: these are the
   human's to trigger, and they are invisible once the PR scrolls off the list.

   Not merge-ready (behind / conflicts) → re-dispatch the babysitter (step 6) with that reason.

9. **Re-poll & continue.** After each merge, re-derive the graph, wave table and claimable frontier
   from the tracker (newly unblocked dependents appear) and repeat from step 3. Re-derive — never
   replay a plan you computed at run start; a human may have edited, closed, or held issues while
   you worked.

10. **Deploy.** When the board is drained (no claimable issues, every adopted PR merged, blocked, or
    ready-for-human-merge) and **at least one PR merged this run**:
    - `commands.deploy` unset → skip (assume CD deploys the default branch).
    - `gates.deploy: auto` → run `commands.deploy` once, after the whole merge batch. Failure →
      report it loudly in the summary; do not retry more than once; never roll back on your own.
    - `gates.deploy: human` → add "ready to deploy" to the run summary.

11. **Terminate (drain once).** Print a run summary:
    - final wave table (with each issue's PR link and state),
    - issues claimed; PRs merged / ready-to-merge / blocked (with reasons),
    - issues sent back as **spec defects** (two-strikes), listed separately from blocked ones,
    - total review rounds and findings **rebutted**, summed from the babysitters' status lines,
      plus any PR recorded `review=skipped-trivial`,
    - open threads escalated for a human decision,
    - **human follow-ups** harvested from merged PRs (backfills, flag flips, secrets, docs sync),
    - deploy outcome.

    Then stop.

## Known risks

Document repo-specific risks (flaky suites, shared local services, port collisions between parallel
executors) as comments in `raw.config.yml` or in your project's CLAUDE.md — and read them before
raising `autopilot.parallel` above 1. Generic ones:

- **Parallel executors sharing one machine** can collide on fixed-port dev services and shared local
  databases. If DB-dependent tests get flaky only when parallel > 1, suspect cross-run interference
  before suspecting the code.
- **CI red with local green** usually means env/schema drift between CI and dev — report `BLOCKED`
  with the differing check output instead of thrashing on it.

## Red flags — stop

- Merging a PR whose babysitter did not return `MERGE_READY`.
- Merging with `gates.merge: human`, or with conflicts / behind the default branch.
- Deploying with `gates.deploy: human`, or when `commands.deploy` is unset.
- Committing or pushing to the default branch; deleting any branch; applying/removing `ai-review:final`.
- Claiming anything not `status:ready` + claimable, or labeled `auto:hold`, or claimed elsewhere.
- Promoting `status:proposed → status:ready` while `gates.promote` is `human`.
- Re-dispatching a babysitter past its own fix cap instead of leaving the issue `status:blocked`.
- Relaunching an issue that already failed execution twice instead of sending it back for rewrite.
- **Reading a diff, a CI log, or a review thread yourself.** You have no tools the babysitter
  lacks and no information it doesn't have — all you do is move PR-scoped content into a
  board-scoped session. Dispatch instead.
- Writing code, reviewing a diff, or dispatching an `auto-executor` directly — those are the
  babysitter's, and a FIX dispatched from here carries no reconciliation behind it.
- Running the project's test or lint commands.
- Re-verifying what `MERGE_READY` already asserts (verdict, CI, fingerprint, evidence gate).
- Two babysitters on the same PR, or running a hand-typed `/babysit-pr` on a PR this run holds.
- Running waves as fixed batches instead of re-deriving the frontier each pass.
- Running while a `/loop /next-task` or scheduled dispatcher is active.
