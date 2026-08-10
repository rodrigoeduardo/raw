# Board Protocol

Single source of truth for how agents interact with the board.

**The tracker state is the machine source of truth.** Every state transition is a write to the tracker, auditable in the item's timeline and re-derivable by a crashed or restarted agent — never held in an agent's head or a run plan. Any visual view a human sets up on top is cosmetic; the tracker wins.

Which tracker, and what "state" means concretely, comes from `raw.config.yml` → `tracker.provider`:

| Provider | State is | Adapter doc |
|---|---|---|
| `github` (default) | **issue labels** on this repo (derive owner/repo at runtime: `gh repo view --json owner,name`) | [`adapters/tracker-github.md`](adapters/tracker-github.md) |
| `linear` | **workflow states** + labels on Linear issues | [`adapters/tracker-linear.md`](adapters/tracker-linear.md) |

This document describes the protocol in GitHub terms, because that is the default and the concrete case; an adapter doc only says how each operation is spelled on its tracker. **PRs are always GitHub**, so `ai-review:*` labels and `review-policy.md` are the same under every tracker.

Workflow configuration (gates, labels, commands) lives in `raw.config.yml` at the repo root. Missing file or key = the defaults documented there (all gates `human`, tracker `github`).

**Integration branch.** Workers cut their branch from — and PRs target — the *integration branch*: `raw.config.yml` → `git.integration_branch` (unset ⇒ the repo's git default branch, `gh repo view --json defaultBranchRef`). Wherever this protocol says "the default branch" — the base for a worktree, the merge-gate "behind" check, "never commit to the default branch" — it means this configured integration branch. Set it whenever development integrates somewhere other than the git default (e.g. a stale `main` release branch vs an active `develop`); a worker cut from the wrong base builds against missing code and opens its PR against the wrong target.

## Labels

### Status (exactly one per open issue)

| Label | Meaning |
|---|---|
| `status:proposed` | Created by planner (or anyone); awaiting promotion |
| `status:ready` | Promoted; claimable by a builder |
| `status:in-progress` | Claimed by a builder (claim comment on the issue) |
| `status:in-review` | PR open and ready; awaiting review/merge |
| `status:blocked` | Stuck; issue has a comment explaining exactly what is needed |

A **closed** issue is done (normally auto-closed by PR merge via `Closes #N`).

### Area (one or more)

`area:<name>` labels scope issues to a domain area. The set is project-specific — defined in `raw.config.yml` under `labels.areas` (e.g. `area:setup`, `area:auth`, `area:billing`). `/configure` can create them.

### Human action (on issues)

| Label | Color | Meaning |
|---|---|---|
| `human-action-needed` | red | The issue's "Human actions" section is non-empty and not yet done — a human must complete those steps before the issue is claimable |

Applied by the planner (or whoever files the issue) whenever the "Human actions" section is anything other than "None". The human removes it once every listed action is done; a builder must not claim an issue while this label is present (it maps to the claimability rule in Lifecycle step 3).

### AI review (on PRs)

| Label | Meaning |
|---|---|
| `ai-review:requested` | An AI review of this PR is requested |
| `ai-review:approved` | AI verdict: acceptance criteria met |
| `ai-review:changes-requested` | AI verdict: issues found (comments on the PR) |
| `ai-review:final` | Human pre-authorizes AI approval to stand in for their own review (see review-policy.md) |

### Orchestration (issues and PRs)

| Label | Meaning |
|---|---|
| `auto:hold` | `/autopilot` skips this issue/PR |

## Gates

Two steps in the lifecycle are gated. Who holds each gate comes from `raw.config.yml`:

- **Promote gate** (`gates.promote`): moving `status:proposed → status:ready`. `human` (default): only a person promotes; closing the issue rejects it. `auto`: agents may promote issues whose acceptance criteria are verifiable and whose "Human actions" is "None".
- **Merge gate** (`gates.merge`): clicking merge on an approved, green, mergeable PR. `human` (default): only a person merges. `auto`: `/autopilot` merges when its merge-gate checklist passes.

A third, post-merge gate (`gates.deploy`) governs deploys — see the `autopilot` skill.

## Lifecycle

1. **Propose** — planner creates issue with `status:proposed` + `area:*`, following the issue template.
2. **Promote** — per the promote gate, the issue is relabeled `status:ready` (possibly after editing).
3. **Claim** — a builder takes the oldest claimable `status:ready` issue. Claimable = all `Depends on #N` issues closed AND no `human-action-needed` label (i.e. the "Human actions" section is "None" or fully done). Claiming = swap label to `status:in-progress` + comment: `Claimed by <session-id> at <ISO timestamp>`.
4. **Build** — `/build-issue <issue>` handles only the claimed issue: branch
   `type/<issue#>-<slug>`, TDD, targeted context, commits on the fly, draft PR after first push.
5. **Deliver** — `/create-pr` finalizes: PR marked ready with `Closes #N`, issue relabeled `status:in-review`.
6. **Merge** — per the merge gate. Merge auto-closes the issue (done).

## Two strikes = spec defect

An issue that reaches `status:blocked` (or burns the review→fix cap) **twice** is a defective
ticket, not a difficult one. The failure is in the issue body — ambiguous scope, acceptance
criteria that can't be checked objectively, a missing decision — and relaunching it with a bigger
model or more context just buys the same failure again.

- **First failure**: normal handling — `status:blocked` + a comment saying exactly what is needed.
  Relaunching after a human unblocks it is fine.
- **Second failure**: relaunch is **forbidden**. Relabel `status:proposed` and comment
  `needs rewrite: <what was ambiguous>`. `/plan-board` picks these up as rewrite proposals.

Count only **execution** failures. A launch failure (worktree/CLI/auth error, agent never started,
runner rejected a model flag) is infrastructure, not spec — relaunch freely, it isn't a strike.

No label tracks this: the issue timeline is the memory. Count `status:blocked` events on the
issue's timeline; a restarted orchestrator re-derives the same count.

## Rules for builders

- **One task per invocation.** Finish (or block) before touching another issue.
- **Before claiming new work**, always first: (a) address human or AI change-requests on your own open PRs; (b) process any PRs labeled `ai-review:requested`.
- **Scope** is the issue's Requirements checklist. Respect "Out of scope". Follow-up ideas go in the PR's Notes section — never into the current diff. The planner turns Notes into proposed issues later.
- **Blocked?** Relabel `status:blocked`, comment precisely what is needed, exit cleanly. Never leave a half-finished PR.
- **Too big?** No PR. Comment a proposed split on the issue and relabel `status:proposed`.
- **Stale claims**: a claim comment older than 24h with no pushes to the task branch may be taken over — comment the takeover, then re-claim.
- **Fresh integration branch**: rebase/branch from the up-to-date integration branch (`git.integration_branch`, above) at the start of every iteration. Unresolvable conflict → PR comment + `status:blocked`.

## Dispatch

The same protocol runs in several modes; the claim comment is the concurrency backstop (a second dispatcher skips claimed issues):

1. **On-demand**: human invokes `/next-task` (optionally `/next-task <issue#>`).
2. **Local loop**: `/loop /next-task`. Stop when: no claimable issues, or ≥3 PRs already sit in `status:in-review` (review is the bottleneck — don't build atop unreviewed work).
3. **Autonomous**: `/autopilot` drains the board end-to-end within the configured gates.
4. **Scheduled agent**: a routine follows this protocol, max 2 tasks per run.

Never run more than one dispatcher (modes 2–4) in the same time window.

Dispatchers select and claim; `/build-issue` implements. Autopilot sends an already claimed issue
to `auto-executor`, which invokes `/build-issue` directly. The builder never lists the board,
chooses another issue, or loops back through `/next-task`.
