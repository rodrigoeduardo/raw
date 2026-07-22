---
name: next-task
description: Use when asked to pick up work from the board — "grab the next task", "work the board", a specific issue number to build, or when running as a loop/scheduled dispatcher iteration.
---

# Next Task (builder)

Claim one ready board issue, build it with TDD, deliver a PR. **One task per invocation.** Never merge, never commit to the default branch — the merge gate (`raw.config.yml` → `gates.merge`) is not yours.

**REQUIRED READING:** `docs/workflow/board-protocol.md` and `docs/workflow/git-conventions.md`. Follow both exactly. Read `raw.config.yml` for commands and bindings (missing file = documented defaults).

## Procedure

1. **Service existing obligations first** (before any new claim):
   - Own open PRs with human or AI change-requests → address them now.
   - PRs labeled `ai-review:requested` → run the `review-pr` skill on each.

2. **Pick.** `gh issue list --label "status:ready" --state open --json number,title,body,createdAt`
   Claimable = every `Depends on #N` line points to a **closed** issue AND "Human actions" is "None" or fully checked. Pick the oldest claimable. Invoked as `/next-task <issue#>` → use that issue (still verify claimability).
   Nothing claimable → report and stop (loop stop condition).
   ≥3 PRs already `status:in-review` → report and stop (review is the bottleneck).

3. **Claim.**
   ```bash
   gh issue edit <n> --remove-label "status:ready" --add-label "status:in-progress"
   gh issue comment <n> --body "Claimed by <session-id> at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
   ```
   Existing claim comment from another session → skip to next issue, unless stale (>24h, no pushes to its branch): comment a takeover, then claim.

4. **Build.**
   - Branch off the fresh default branch: `type/<issue#>-<slug>` (e.g. `feat/23-user-signup-form`).
   - **REQUIRED SUB-SKILL:** the TDD skill bound in `raw.config.yml` (`bindings.tdd`, default `superpowers:test-driven-development`).
   - Commit on the fly per git-conventions.md; push early; open a **draft PR** after first push.
   - Scope = the issue's Requirements checklist. Respect "Out of scope". Follow-ups go in PR Notes, never in the diff.

5. **Deliver.**
   - **REQUIRED SUB-SKILL:** the verification skill bound in `raw.config.yml` (`bindings.verification`, default `superpowers:verification-before-completion`). Run the configured `commands.lint` and `commands.test_all` — green before handoff.
   - Use the `create-pr` skill to finalize (template, ready state).
   - `gh issue edit <n> --remove-label "status:in-progress" --add-label "status:in-review"`
   - Stop.

## Blocked or too big

- **Blocked** (missing info, spec gap, env failure): label `status:blocked`, comment exactly what is needed, push WIP to the branch, stop. Never a half-finished ready PR.
- **Too big** (discovered mid-build): no PR; comment a proposed split; relabel `status:proposed`; stop.

## Red flags — stop

- Claiming while own PRs have unaddressed change-requests
- Working two issues in one invocation
- Expanding scope beyond the Requirements checklist
- Merging, or committing to the default branch
