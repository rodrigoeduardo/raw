# raw — Design

**Status:** Living document. Originally designed 2026-07-16 inside a private product repo; extracted and genericized into this standalone package 2026-07-22.

## Problem

AI agents are good at building small, well-specified tasks and bad at deciding what to build, when to stop, and when a human must look. raw is a reusable workflow in which an AI planner proposes tasks as GitHub Issues and AI builders pull tasks from that board — on demand or autonomously — with **explicit, configurable human control points**.

## Core ideas

1. **GitHub Issues are the board; labels are the machine source of truth.** No visual board tooling is part of the workflow — every state transition is a label swap, auditable in the issue timeline, and re-derivable by a crashed/restarted agent.
2. **Gates are configuration, not doctrine.** Three gates — promote (`proposed → ready`), merge, deploy — each set to `human` or `auto` in `raw.config.yml`. Defaults are all-human; turning a gate to `auto` is an explicit, versioned decision in the target repo.
3. **Skills are small and self-contained.** `/plan-board`, `/next-task`, `/create-pr`, `/review-pr` each work when invoked directly by a human. The orchestrator (`/autopilot`) composes them via sub-agents; orchestrator-only plumbing (status lines, delta re-reviews) lives in the agent definitions, never in the skills.
4. **Specs drive planning; issues drive building; the diff drives review.** The planner reads `specs_dir` and proposes; builders implement exactly the issue's Requirements checklist; reviewers verify claims against the actual diff, never the PR body's assertions.
5. **Concurrency by claim comment.** Claiming = label swap + timestamped comment. Any second dispatcher (loop, schedule, autopilot) skips live claims; stale claims (>24h, no pushes) are taken over with a comment. No locks, no external state.
6. **Everything repo-specific is config.** Commands (install/lint/test/deploy), area labels, specs dir, and sub-skill bindings (which TDD/verification skill to invoke) live in `raw.config.yml`, edited by hand or via the `/configure` interview.

## Roles

| Role | Where | Does |
|---|---|---|
| Planner | `/plan-board` skill | Specs → draft → (approval) → proposed issues |
| Builder | `/next-task` skill | Claim → TDD build → draft PR → `/create-pr` → in-review |
| Reviewer | `/review-pr` skill | Diff vs acceptance criteria → comments + verdict label |
| Orchestrator | `/autopilot` skill | Dispatch executors/reviewers, fix loop, merge gate, deploy step |
| Workers | `auto-executor`, `auto-reviewer` agents | Isolated single-job wrappers around the skills above |

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

## Staying up to date

Installs are plain copied files, not a managed dependency, so raw tracks drift itself instead of assuming a package manager:

- `raw init` writes `.raw-manifest.json`: the installed version plus a sha256 of every installed file as copied.
- `raw update` recomputes hashes, compares each file to the manifest baseline, and only overwrites files that are unchanged since install — anything a human edited is reported and skipped (`--force` to overwrite anyway). `CLAUDE.md`'s managed block is always refreshed; it's marked, never meant to be hand-edited.
- Notification is pull-based, not pushed: `raw-update-check.yml` runs on a schedule in the *target* repo, diffs its manifest version against raw's `main`, and opens an `auto:hold` issue if behind. No hosted registry, no telemetry back to this repo.
- Pre-manifest installs bootstrap via `raw manifest bootstrap`, which baselines whatever's on disk as "unmodified" — any edits made before that point are invisible to future diffs.

## History

The original design had two hard-coded human gates (task approval, merge click) and a separate `auto-next-task` skill that deliberately broke the merge gate with a documented divergence note. The extraction replaced that with the config gate layer: `/autopilot` is the one orchestrator, and how far it goes (merge? deploy?) is a per-repo setting instead of a rule-break.
