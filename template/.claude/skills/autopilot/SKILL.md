---
name: autopilot
description: Use to run the board autonomously — claim every ready+claimable issue, build it, AI-review it, and (per configured gates) merge and deploy. Orchestrator only; spawns auto-executor and auto-reviewer sub-agents. Invoke explicitly (/autopilot); never self-trigger.
---

# Autopilot (autonomous dispatcher)

Drain the board: claim ready+claimable issues, spawn workers to build them, spawn reviewers to
review the PRs, loop review→fix until approved, then merge and deploy **as far as the configured
gates allow**. You are the orchestrator — you coordinate; you do **not** write code or review diffs
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

Also tiered review cost: trivial PRs skip AI review entirely (step 6), and fix-cycle re-reviews are
delta-only, not from-scratch (step 7). Neither changes what a full first review of substantive code
checks — they only cut redundant re-checking.

## Run this on the right session

- **Main (this) agent:** the orchestrator only does bookkeeping (labels, dispatch, merge-gate
  checklist) — state is re-derived from GitHub, so a small/cheap model session is the right home.
  For long boards, prefer draining in chunks: stop after a handful of merges and re-invoke in a
  fresh session (steps 2–3 re-adopt everything) rather than letting one session's context grow
  unbounded.
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

3. **Build the claimable set.**
   ```bash
   gh issue list --label "status:ready" --state open --json number,title,body,labels,createdAt
   ```
   Keep an issue only if: every `Depends on #N` points to a **closed** issue; "Human actions" is
   "None" or fully checked; it is **not** labeled `auto:hold`; and it has no live claim comment from
   another session. Order by **most dependents unblocked first**, then oldest. (Dependents are
   naturally deferred — they are not claimable until their blocker merges and closes.)
   Empty set: if `gates.promote` is `auto`, you may promote `status:proposed` issues that have
   verifiable acceptance criteria, "Human actions" = "None", and no `auto:hold` — then rebuild the
   set. Still empty and no open PRs left → go to step 10.

4. **Claim** the next issue (or, with `autopilot.parallel` > 1, the next N independent ones — never
   ones that share obvious files):
   ```bash
   gh issue edit <n> --remove-label "status:ready" --add-label "status:in-progress"
   gh issue comment <n> --body "Claimed by <session-id> at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
   ```
   A fresh claim comment from another session → skip. Stale (>24h, no branch pushes) → comment a
   takeover, then claim.

5. **Build.** Dispatch an `auto-executor` (mode BUILD) per claimed issue.
   - Sequential (parallel=1, default): one dispatch, wait for its status line, then continue.
   - parallel>1: issue N dispatches in one turn; each gets its own worktree.
   On `BLOCKED`/`TOO_BIG` → the worker already labeled the issue; record it and move on.
   On `DONE pr=#<p>` → proceed to review that PR.

6. **Request review — unless trivial.** Check `gh pr diff <p> --name-only` and
   `gh pr view <p> --json additions,deletions`. Skip the reviewer entirely when the diff touches
   **only** docs/config paths (`*.md`, `.github/**`, `.claude/**`, dotfiles, `raw.config.yml`)
   **or** total changed lines < ~30 with no source files touched. For a skipped PR: don't apply
   `ai-review:requested`, treat the review part of the merge gate (step 8) as satisfied by green
   CI + mergeable alone, and record "review skipped: trivial" for it in the run summary.
   Otherwise: `gh pr edit <p> --add-label "ai-review:requested"`, dispatch an `auto-reviewer` for PR
   `<p>` as a **first review**. Wait for `APPROVED` / `CHANGES_REQUESTED`.

7. **Fix loop (cap = `autopilot.max_fix_cycles`, default 3).** A "round" = one AI review verdict on
   the PR. Derive the current round count from the PR timeline (count of `ai-review:*` verdicts /
   reviewer comments) so a restarted orchestrator resumes correctly — do not rely on memory.
   - `ai-review:changes-requested`, **or** `gh pr checks <p>` red, **or** PR behind the default
     branch: dispatch an `auto-executor` (mode FIX) with the PR number, branch, and reason. On its
     `DONE`, re-apply `ai-review:requested` and dispatch `auto-reviewer` again as a **delta
     re-review**, passing it the previous round's blocking findings and the SHA it last reviewed
     (last `ai-review:*` label event) so it diffs only what changed since then.
   - Rounds ≥ cap and still not clean → label the **issue** `status:blocked` and comment what
     remains, leave the PR+branch untouched for a human, stop working this PR.

8. **Merge gate.** A PR is **merge-ready** only when ALL hold:
   - label `ai-review:approved` present (or the PR was skip-reviewed as trivial in step 6),
   - `gh pr checks <p>` — every check **green**. If checks are still running, don't poll in a loop:
     run `gh pr checks <p> --watch --fail-fast` as a single **background** command with a ~10 min
     timeout, and continue other bookkeeping (re-derive the claimable set, adopt other open PRs)
     while it runs. React to its result when it completes; still pending/timed out → treat as
     not-ready, revisit next pass,
   - PR **mergeable**, not behind the default branch (`gh pr view <p> --json mergeable,mergeStateStatus`).

   Then, per `gates.merge`:
   - `auto`:
     ```bash
     gh pr merge <p> --squash          # NO --delete-branch
     ```
     Merge auto-closes the issue via `Closes #N`; `pr-merged-cleanup.yml` strips `status:in-review`.
   - `human`: record the PR as **ready to merge** in the run summary and move on — never merge.

   Not merge-ready (red / behind / conflicts) → route back to the fix loop (step 7), counts against
   the cap.

9. **Re-poll & continue.** After each merge, re-derive the claimable set (newly unblocked dependents
   appear) and repeat from step 3.

10. **Deploy.** When the board is drained (no claimable issues, every adopted PR merged, blocked, or
    ready-for-human-merge) and **at least one PR merged this run**:
    - `commands.deploy` unset → skip (assume CD deploys the default branch).
    - `gates.deploy: auto` → run `commands.deploy` once, after the whole merge batch. Failure →
      report it loudly in the summary; do not retry more than once; never roll back on your own.
    - `gates.deploy: human` → add "ready to deploy" to the run summary.

11. **Terminate (drain once).** Print a run summary: issues claimed, PRs merged / ready-to-merge /
    blocked (with reasons), total review rounds, deploy outcome. Then stop.

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
- Writing code or reviewing a diff yourself — always delegate to a worker.
- Running while a `/loop /next-task` or scheduled dispatcher is active.
