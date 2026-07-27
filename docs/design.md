# raw — Design

**Status:** Living document. Originally designed 2026-07-16 inside a private product repo; extracted and genericized into this standalone package 2026-07-22.

## Problem

AI agents are good at building small, well-specified tasks and bad at deciding what to build, when to stop, and when a human must look. raw is a reusable workflow in which an AI planner proposes tasks as GitHub Issues and AI builders pull tasks from that board — on demand or autonomously — with **explicit, configurable human control points**.

## Core ideas

1. **The tracker state is the machine source of truth.** No visual board tooling is part of the workflow — every state transition is a write to the tracker, auditable in the item's timeline, and re-derivable by a crashed/restarted agent. On the default tracker (GitHub Issues) that state is labels.
2. **Gates are configuration, not doctrine.** Three gates — promote (`proposed → ready`), merge, deploy — each set to `human` or `auto` in `raw.config.yml`. Defaults are all-human; turning a gate to `auto` is an explicit, versioned decision in the target repo.
3. **Skills are small and self-contained.** `/plan-board`, `/next-task`, `/create-pr`, `/review-pr` each work when invoked directly by a human. The orchestrator (`/autopilot`) composes them via sub-agents; orchestrator-only plumbing (status lines, delta re-reviews) lives in the agent definitions, never in the skills.
4. **Specs drive planning; issues drive building; the diff drives review.** The planner reads `specs_dir` and proposes; builders implement exactly the issue's Requirements checklist; reviewers verify claims against the actual diff, never the PR body's assertions.
5. **Concurrency by claim comment.** Claiming = label swap + timestamped comment. Any second dispatcher (loop, schedule, autopilot) skips live claims; stale claims (>24h, no pushes) are taken over with a comment. No locks, no external state.
6. **Everything repo-specific is config.** Commands (install/lint/test/deploy/dev), area labels, specs dir, sub-skill bindings (which TDD/verification skill to invoke) and provider choices (tracker, worktrees, runners) live in `raw.config.yml`, edited by hand or via the `/configure` interview.
7. **Scheduling is a re-derived frontier, not a plan.** Dependencies (`Depends on #N`, or native relations on trackers that have them) form a DAG; **waves** — `max(wave of blockers) + 1` — are computed and printed for humans to read, but dispatch always picks from the *currently claimable frontier*, recomputed from the tracker on every pass. A batch plan computed at run start is a snapshot, and snapshots go stale the moment a human edits the board or a run crashes mid-wave.
8. **A ticket that fails twice is a spec defect.** Two execution failures on one issue means the issue body is ambiguous, not that the model was too small. Relaunch is forbidden at that point: the issue goes back to `proposed` with a `needs rewrite:` comment and the planner rewrites it. Launch/infra failures don't count — they aren't evidence about the spec.
9. **Findings are input, not verdicts.** Before a review finding becomes work, someone opens the code and confirms it reproduces. Under `/autopilot` that someone is the orchestrator (a bounded read-only step, see below); by hand it's you. Forwarding a confidently-wrong finding costs a full implementation round fixing a bug that doesn't exist, and can turn correct code into a regression that passes review.
10. **Evidence over assertion for user-visible work.** A green test proves the logic ran, not that anything rendered. When an issue is user-visible, "done" requires a screenshot of the real app driving the real flow — and, critically, that *someone other than the worker looked at it* (the reviewer does, before the verdict). Capture is a documented default (Playwright, MCP or CLI) rather than an improvisation, and the artifact is **committed** to the task branch, because GitHub has no attachment API and an artifact nobody can open is not evidence. Inert for headless repos; when capture is impossible the gate blocks rather than degrading, since a silent skip is the exact failure it exists to catch.
11. **Providers are adapters, not branches in the logic.** Tracker, worktree provider and runner are swappable via `raw.config.yml` + one doc each under `docs/workflow/adapters/`. The decision logic in the skills never changes with the provider — only the spelling of the operations does. Defaults (github / claude worktrees / claude runners) keep the visible, zero-cost path inline in the skills.

## Roles

| Role | Where | Does |
|---|---|---|
| Planner | `/plan-board` skill | Specs → draft → (approval) → proposed issues |
| Builder | `/next-task` skill | Claim → TDD build → draft PR → `/create-pr` → in-review |
| Reviewer | `/review-pr` skill | Diff vs acceptance criteria → comments + verdict label |
| Adversarial reviewer (opt-in) | `runners.adversarial_reviewer` | Second review from another model family → comments only, never a verdict |
| PR babysitter | `/babysit-pr` skill | One PR: CI triage, finding reconciliation, fix, merge-ready |
| Orchestrator | `/autopilot` skill | Claim issues, dispatch executors and babysitters, merge gate, deploy step |
| Workers | `auto-executor`, `auto-babysitter`, `auto-reviewer` agents | Isolated single-job wrappers around the skills above |

The per-PR procedure lives in `docs/workflow/pr-babysit.md` and is shared: `/babysit-pr` is its
entry point, invoked either by a human on one PR or by an `auto-babysitter` that `/autopilot`
dispatches per PR. One procedure, two callers, no drift.

### Two context lifetimes, two sessions

Finding reconciliation (core idea 9) **reads code** — it verifies a specific claim before a fix
round is spent on it. So do CI triage and feedback triage. That work is unavoidable, but it is
**PR-scoped**: once the PR merges, none of it matters again.

The orchestrator's own state is **board-scoped**: the dependency graph, the claimable frontier,
what merged this run. It has to survive the whole drain.

Running both in one session means the disposable content accumulates in the durable one, and a long
board eventually forces a restart mid-run. So the per-PR work happens in a dispatched
`auto-babysitter` whose context dies with the PR, and the orchestrator gets back a status line.
That keeps it a cheap bookkeeper again — labels, dispatch, checklists, all state re-derived from the
tracker, and it never reads a diff or a CI log.

The judgement requirement moves with the work: `runners.babysitter` defaults to a stronger model
than the executor and reviewer, because telling a real finding from a confident hallucination is the
call the whole fix loop hangs on.

Merging stays with the orchestrator, and that is the one thing the split can't relax: each merge
changes the default branch the frontier is re-derived from, so parallel babysitters merging on their
own would race it.

## Lifecycle

```
status:proposed ──(promote gate)──> status:ready ──claim──> status:in-progress
    ──draft PR / create-pr──> status:in-review ──review verdict──(merge gate)──> merged/closed
                                                                └──(deploy gate)──> deployed
```

Escape hatches at every stage: `status:blocked` (+ precise comment), `TOO_BIG` (back to proposed with a split proposal), `auto:hold` (skip label), `AUTO-STOP` issue (aborts autopilot runs).

## Edge cases

| Situation | Handling |
|---|---|
| Builder can't complete | `status:blocked` + precise comment; exit cleanly, never half-PR |
| Stale claim (dead session) | Claim >24h old with no branch pushes → next dispatcher comments a takeover and re-claims |
| Task too big mid-build | No PR; comment a proposed split; back to `status:proposed` |
| PR change-requests | Always addressed before claiming new work, in any mode |
| Default branch moved | Rebase each iteration; unresolvable → PR comment + `status:blocked` |
| Follow-up discovered | Never expands scope; goes in PR Notes → next `/plan-board` delta |
| Pending Human actions | Issue unclaimable regardless of `status:ready` until checked off |
| Fix loop doesn't converge | `max_fix_cycles` cap → `status:blocked`, PR left for a human |
| Same issue fails twice | Spec defect: back to `proposed` + `needs rewrite:` comment; relaunch forbidden; planner rewrites |
| Worker never launched (CLI/auth/model error) | Infrastructure, not spec — relaunch freely, doesn't count as a strike |
| CI red from a cancelled run | Check for a newer commit + in-flight run before treating it as failure (the worker is usually self-healing) |
| Review finding that doesn't reproduce | Rebutted with evidence on the thread; no fix round paid; delta re-reviews treat it as closed |
| Feedback lands after CI goes green | Feedback fingerprint (comments + reviews + inline threads) revokes merge-readiness until triaged |
| Ambiguous / conflicting review feedback | Not guessed and not dismissed — thread stays open, escalated to a human with the options |
| UI feature "done" but invisible | Evidence gate: screenshot from the real app, checked by the reviewer before the verdict |
| Evidence gate active, `commands.dev` unset | Builder reports `BLOCKED` — the gate is never silently skipped |
| Dev server starts but prints no URL in 60s | `BLOCKED: dev server never printed a URL` (usually a missing env var, not a code problem) |
| No Playwright MCP server and no `npx playwright` | `BLOCKED: no playwright driver available` — or set `evidence.driver: manual` deliberately |
| Screenshot can't be "attached" to a PR | GitHub has no attachment API; the artifact is committed to the task branch as `docs/evidence/<issue#>-<slug>.png` and linked from Requirements coverage |
| Human follow-ups in a merged PR | Harvested from "Human actions needed" into the run summary — surfaced, never auto-done |

## Deliberate divergences

Several of the ideas above come from a production orchestration workflow (Linear project → dependency
DAG → merge-gated waves of worktrees, one autonomous agent per ticket). Some of its choices were
deliberately **not** adopted, and the reasons matter more than the choices:

- **Wave batches as the scheduling mechanism.** Adopted as ordering and reporting only. A wave batch
  is a plan computed at run start; raw re-derives the claimable frontier from the tracker on every
  pass, which is what makes a crashed run, a mid-run human edit, or a hand-merged PR harmless.
- **A persistent `while true` bash monitor daemon.** Fragile and restart-hostile — its state lives in
  a temp file that a crash orphans. What was worth stealing is its *state keying*: CI by
  branch+SHA+conclusion, reviews by feedback fingerprint. Those are now rules, not a daemon.
- **The orchestrator fixing CI itself** ("`mix format` is the one fix you may run yourself"). Fixes
  stay dispatched. One exception to "the orchestrator never writes code" becomes several within a
  month, and the orchestrator is the session with the least context about the code.
- **Baked-in never-re-ask defaults.** Right for a personal skill, wrong for a reusable product:
  raw's generalization of "decide once, then stop asking" is `raw.config.yml` + `/configure`.
- **The ticket as the *only* spec.** Fully self-contained prompts are required only where forced —
  the codex runner, which can't read skills. Claude workers keep reading the repo's living docs:
  cheaper prompts, and no copy of the conventions to age.
- **Project-policy ticket requirements** (i18n, LGPD, and similar). Those belong in the target repo's
  `docs/specs/business-rules.md`, which the planner already reads — not in a workflow package.

## Staying up to date

Installs are plain copied files, not a managed dependency, so raw tracks drift itself instead of assuming a package manager:

- `raw init` writes `.raw-manifest.json`: the installed version plus a sha256 of every installed file as copied.
- `raw update` recomputes hashes, compares each file to the manifest baseline, and only overwrites files that are unchanged since install — anything a human edited is reported and skipped (`--force` to overwrite anyway). `CLAUDE.md`'s managed block is always refreshed; it's marked, never meant to be hand-edited.
- Notification is pull-based, not pushed: `raw-update-check.yml` runs on a schedule in the *target* repo, diffs its manifest version against raw's `main`, and opens an `auto:hold` issue if behind. No hosted registry, no telemetry back to this repo.
- Pre-manifest installs bootstrap via `raw manifest bootstrap`, which baselines whatever's on disk as "unmodified" — any edits made before that point are invisible to future diffs.

## History

**2026-07-27 — worktree env seeding, template CI.** Two defects from a real autopilot run. The
evidence gate's `commands.dev` cannot start in a fresh worktree, because a worktree is a checkout of
*tracked* files and env files are gitignored — so `evidence.ui_screenshot: auto` was unsatisfiable
on any repo whose dev server needs env, and workers improvised (one copied env out of a sibling
worker's worktree). Fixed declaratively with `worktrees.seed_files`, copied from the primary repo
root during the worker's preflight and deleted before it reports. Not a harness hook: Claude Code's
`worktree.symlinkDirectories` takes directories rather than files, and its `WorktreeCreate` hook
*replaces* worktree creation rather than extending it, so seeding is raw's own step. Separately,
`raw-update-check.yml` had never run anywhere — an unindented line inside its `run: |` block
terminated the block scalar, and GitHub reports an unparseable workflow as a failed 0s run on every
push. Nothing in this repo could catch that, since `template/.github/workflows/` is inert here; a
root `ci.yml` now parses every shipped YAML file and smoke-tests `raw init`.

**2026-07-26 — waves, evidence, reconciliation, adapters.** Absorbed the lessons of a larger
production run of the same shape of system: explicit dependency DAG + wave table (as reporting, over
a re-derived frontier), richer ticket template ("the ticket is the prompt") and explicit planner
decomposition rules, the two-strikes spec-defect rule, CI/review state keying (CANCELLED ≠ FAIL,
feedback fingerprint), orchestrator-side finding reconciliation, the user-visible evidence gate, a
standalone `/babysit-pr` sharing one procedure doc with autopilot, and provider adapters (Linear
tracker, orca/conductor worktrees, codex runner, adversarial reviewer) — all opt-in, all defaulting
to the previous behavior. The one architectural concession is the orchestrator's bounded read-only
code verification, documented above.

The original design had two hard-coded human gates (task approval, merge click) and a separate `auto-next-task` skill that deliberately broke the merge gate with a documented divergence note. The extraction replaced that with the config gate layer: `/autopilot` is the one orchestrator, and how far it goes (merge? deploy?) is a per-repo setting instead of a rule-break.
