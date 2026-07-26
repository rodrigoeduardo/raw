---
name: autopilot
description: Use to run the board autonomously — claim every ready+claimable issue, build it, AI-review it, and (per configured gates) merge and deploy. Orchestrator only; spawns auto-executor and auto-reviewer sub-agents. Invoke explicitly (/autopilot); never self-trigger.
---

# Autopilot (autonomous dispatcher)

Drain the board: claim ready+claimable issues, spawn workers to build them, spawn reviewers to
review the PRs, loop review→fix until approved, then merge and deploy **as far as the configured
gates allow**. You are the orchestrator — you coordinate; you do **not** write code or review diffs
yourself.

**REQUIRED READING:** `docs/workflow/board-protocol.md`, `git-conventions.md`, `review-policy.md`,
`pr-babysit.md` (the per-PR procedure steps 6–8 run).

## Step 0 — read config

Read `raw.config.yml` (missing file/keys = documented defaults). You care about:

- `gates.promote` (`human` default): `auto` lets you promote qualifying `status:proposed` issues.
- `gates.merge` (`human` default): `auto` lets you merge PRs that pass the merge-gate checklist.
  `human` → you stop each PR at "approved + green", label state speaks for itself, and your run
  summary lists PRs ready for a human merge.
- `gates.deploy` (`human` default) + `commands.deploy`: whether/how you deploy after merges.
- `autopilot.parallel` (default 1), `autopilot.max_fix_cycles` (default 3).
- `tracker.provider` (default `github`), `worktrees.provider` (default `claude`), `runners.*`
  (default claude/sonnet), `evidence.ui_screenshot` (default `auto`) + `commands.dev`.

**Adapters.** Every board operation below is written in GitHub terms because that is the default.
If `tracker.provider` is not `github`, read `docs/workflow/adapters/tracker-<provider>.md` first and
perform the equivalent operation there — the protocol (states, claims, dependencies, gates) is
identical, only the spelling changes; PRs and `ai-review:*` labels stay on GitHub either way.
Likewise, dispatch below says "dispatch an `auto-executor`/`auto-reviewer`", which is the
`worktrees.provider: claude` + `runners.*.runner: claude` path; any other combination follows
`docs/workflow/adapters/worktrees-<provider>.md` and `.../runner-<runner>.md`, which define how the worker is
launched and how its result comes back. The decision logic in this skill never changes with either.

Also tiered review cost: trivial PRs skip AI review entirely (step 6), and fix-cycle re-reviews are
delta-only, not from-scratch (step 7). Neither changes what a full first review of substantive code
checks — they only cut redundant re-checking.

## Run this on the right session

- **Main (this) agent:** the orchestrator does bookkeeping (labels, dispatch, merge-gate checklist)
  **plus one bounded read-only judgement call**: verifying review findings against the code before
  dispatching a fix (step 7b). So this is not a job for the cheapest available model — it needs a
  session that can read a diff and tell a real finding from a confident hallucination. It still
  never writes code. State is re-derived from GitHub, so the session stays cheap in context if not
  in capability. For long boards, prefer draining in chunks: stop after a handful of merges and
  re-invoke in a fresh session (steps 2–3 re-adopt everything) rather than letting one session's
  context grow unbounded.
- **Workers:** dispatched as `auto-executor` and `auto-reviewer` agents (see `.claude/agents/`).
- **Do not** run this alongside a `/loop /next-task` session or a scheduled dispatcher (they share
  the claim-comment backstop and will collide). One autonomous dispatcher at a time.

## Setup (once per repo)

`gh label create auto:hold --description "autopilot: skip this issue/PR" 2>/dev/null || true`.
STOP marker convention: an open issue whose title is exactly `AUTO-STOP`. Its presence aborts runs.

## Procedure

1. **Abort check.** `gh issue list --search "AUTO-STOP in:title" --state open` → if found, print
   "STOP marker present — aborting" and stop. Record your session-id for claim comments.

2. **Adopt open PRs first** (service obligations before new work). For every open PR, drive it
   through the review→merge loop (steps 6–8) before claiming any new issue. This clears PRs left by
   prior runs or humans. Skip any PR labeled `auto:hold`.

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
   On `DONE pr=#<p>` → proceed to review that PR.

6. **PR-open sanity check, then request review — unless trivial.** Run the scope check from
   `docs/workflow/pr-babysit.md` §0 (`gh pr view <p> --json baseRefName,headRefName,files`): targets
   the default branch, head is the issue's `type/<issue#>-<slug>` branch, files plausibly in scope.
   Drift → comment it on the PR and route through the fix loop (step 7) before spending a review.

   Then check `gh pr diff <p> --name-only` and
   `gh pr view <p> --json additions,deletions`. Skip the reviewer entirely when the diff touches
   **only** docs/config paths (`*.md`, `.github/**`, `.claude/**`, dotfiles, `raw.config.yml`)
   **or** total changed lines < ~30 with no source files touched. For a skipped PR: don't apply
   `ai-review:requested`, treat the review part of the merge gate (step 8) as satisfied by green
   CI + mergeable alone, and record "review skipped: trivial" for it in the run summary.
   Otherwise: `gh pr edit <p> --add-label "ai-review:requested"`, dispatch an `auto-reviewer` for PR
   `<p>` as a **first review**. Wait for `APPROVED` / `CHANGES_REQUESTED`.

   **Adversarial reviewer** (only if `runners.adversarial_reviewer` is set): dispatch it on the same
   PR, in parallel with the first review, per `docs/workflow/adapters/runner-<runner>.md`. It posts findings as PR
   comments and **sets no label** — raw's reviewer still owns the verdict. Its findings reach you via
   the feedback fingerprint (step 7c) and go through the same reconciliation as everyone else's.

7. **Fix loop (cap = `autopilot.max_fix_cycles`, default 3).** A "round" = one AI review verdict on
   the PR. Derive the current round count from the PR timeline (count of `ai-review:*` verdicts /
   reviewer comments) so a restarted orchestrator resumes correctly — do not rely on memory.

   **Procedure: `docs/workflow/pr-babysit.md`** — the shared babysit procedure (`/babysit-pr` runs
   the same one). Read it; the essentials you must not skip:

   **7a. Triage CI before believing it** (§1). Key CI state by **branch + head SHA + conclusion**.
   **CANCELLED ≠ FAIL**: a newer commit with a run in progress means the executor is self-healing —
   let it conclude instead of dispatching a FIX against a stale SHA.

   **7b. Reconcile findings against the code before paying a fix round** (§3). Findings — raw's
   reviewer, an adversarial reviewer, a bot, a human — are input, not verdicts, and dispatching a
   wrong one costs a full executor round fixing a bug that doesn't exist. **Open the code and
   confirm each blocking finding reproduces.** This is the one place you read code; you still never
   write it. Reproduces → into the FIX dispatch. Doesn't → reply with the evidence, record it as
   **rebutted**, leave the correct code alone. Ambiguous/scope-expanding → escalate, don't dispatch.
   Every blocking finding rebutted = **not a fix round**: re-request review (or go to the merge gate
   if CI is green) and don't count it against the cap.

   **7c. Feedback fingerprint** (§2). Hash the PR's comments + reviews + inline threads (ids +
   timestamps), keyed `branch:sha:fingerprint`. An untriaged fingerprint **revokes** "ready to
   merge" even with `ai-review:approved` + green CI. Raw's own reviewer stays label-driven; the
   fingerprint covers everyone else on the PR.

   **7d. Dispatch the fix.** For confirmed reasons — `ai-review:changes-requested` with at least one
   reproduced finding, genuine red CI on the head SHA, PR behind the default branch, or scope drift
   from step 6 — dispatch an `auto-executor` (mode FIX) with the PR number, branch, and the reason,
   listing **only the confirmed findings**. On its `DONE`, re-apply `ai-review:requested` and
   dispatch `auto-reviewer` again as a **delta re-review**, passing it the previous round's blocking
   findings, the findings you rebutted (so it doesn't re-raise them without new evidence), and the
   SHA it last reviewed (last `ai-review:*` label event) so it diffs only what changed since then.

   **7e. Cap reached.** Rounds ≥ cap and still not clean → label the **issue** `status:blocked` and
   comment what remains, leave the PR+branch untouched for a human, stop working this PR. Then apply
   the **two-strikes rule** (board-protocol.md): if this issue's timeline shows it has now hit
   `status:blocked` for the **second** time on an execution failure (not a launch/infra error), do
   not leave it to be relaunched — relabel it `status:proposed` and comment
   `needs rewrite: <what was ambiguous>` so `/plan-board` picks it up as a rewrite. Record it in the
   run summary as a spec defect, not as a blocked task.

8. **Merge gate.** A PR is **merge-ready** only when ALL hold:
   - label `ai-review:approved` present (or the PR was skip-reviewed as trivial in step 6),
   - `gh pr checks <p>` — every check **green**. If checks are still running, don't poll in a loop:
     run `gh pr checks <p> --watch --fail-fast` as a single **background** command with a ~10 min
     timeout, and continue other bookkeeping (re-derive the frontier, adopt other open PRs)
     while it runs. React to its result when it completes; still pending/timed out → treat as
     not-ready, revisit next pass,
   - PR **mergeable**, not behind the default branch (`gh pr view <p> --json mergeable,mergeStateStatus`),
   - the current **feedback fingerprint** (step 7c) has been triaged — untriaged feedback revokes
     merge-readiness no matter what the labels say,
   - the **evidence gate** is satisfied for user-visible work (review-policy.md) — the reviewer
     enforces this, so a skip-reviewed "trivial" PR must never be a user-visible one.

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

   Not merge-ready (red / behind / conflicts) → route back to the fix loop (step 7), counts against
   the cap.

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
    - total review rounds, and findings **rebutted** during reconciliation (step 7b),
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

- Merging with `gates.merge: human`, or on approval alone, or with red/pending CI, or with
  conflicts / behind the default branch.
- Deploying with `gates.deploy: human`, or when `commands.deploy` is unset.
- Committing or pushing to the default branch; deleting any branch; applying/removing `ai-review:final`.
- Claiming anything not `status:ready` + claimable, or labeled `auto:hold`, or claimed elsewhere.
- Promoting `status:proposed → status:ready` while `gates.promote` is `human`.
- Looping a PR past the fix cap instead of marking it `status:blocked`.
- Relaunching an issue that already failed execution twice instead of sending it back for rewrite.
- **Writing** code, or performing a full review of a diff, yourself — always delegate to a worker.
  (Reading code to verify a specific review finding, step 7b, is the one sanctioned exception.)
- Dispatching a FIX for findings you never verified against the code.
- Treating a CANCELLED run as a genuine CI failure without checking for a newer commit + fresh run.
- Merging a PR with untriaged feedback on it, however green the checks are.
- Running waves as fixed batches instead of re-deriving the frontier each pass.
- Running while a `/loop /next-task` or scheduled dispatcher is active.
