---
name: build-issue
description: Build exactly one already selected and claimed tracker issue. Use only with an explicit issue id; never selects, schedules, or claims work.
---

# Build Issue (single-issue executor)

Implement **exactly one explicit issue** that orchestration has already selected and claimed. The
input issue is the complete work boundary. Build it, deliver its PR, and stop.

**REQUIRED READING:** `docs/workflow/git-conventions.md`, the exact assigned issue, and only the
spec/code ranges its acceptance criteria and technical pointers require. Read `raw.config.yml` for
commands, bindings, tracker, integration branch, and evidence settings. Under a non-GitHub tracker,
use `docs/workflow/adapters/tracker-<provider>.md` for exact-issue reads and transitions.

## Preconditions

1. Require an explicit issue id. Missing input → stop; do not discover one.
2. Fetch only that issue and verify it exists, is assigned to this invocation, and is in
   `status:in-progress` (or the provider-equivalent state) with a claim. If not, report the precise
   mismatch and stop. Do not claim it here.
3. Treat Requirements, acceptance criteria, Test scenarios, technical pointers, Out of scope, and
   Human actions on that issue as authoritative. Resolve dependencies only to verify the assigned
   issue remains buildable; never load the ready queue or unrelated issues.

## Build

1. Run the worktree preflight from `docs/workflow/adapters/worktrees-<provider>.md`: install missing
   dependencies, seed only configured files, and verify the documented environment. Missing env is
   `BLOCKED`, not a reason to invent values.
2. Branch from the fresh configured integration branch as `type/<issue#>-<slug>` following
   `docs/workflow/git-conventions.md`. Push early and open a draft PR after the first push.
3. Start from the issue's acceptance criteria and technical pointers. Use targeted search before
   opening files; read only the relevant ranges. Invoke the TDD skill bound at `bindings.tdd`
   (default `superpowers:test-driven-development`): failing test first, minimal implementation,
   then refactor while green. Scope is the issue; record follow-ups in PR Notes.
4. Invoke the verification skill bound at `bindings.verification` (default
   `superpowers:verification-before-completion`). Run configured `commands.lint` and
   `commands.test_all`; an unset command is skipped and reported, never guessed.
5. When the evidence gate is active, follow `docs/workflow/adapters/evidence-playwright.md`. The
   default executor-owned path is bounded Playwright CLI capture, not an open-ended browser/MCP
   session. Commit the evidence artifact separately and link it under Requirements coverage.
6. Invoke `/create-pr` to finalize the draft. Transition only the assigned issue from
   `status:in-progress` to `status:in-review` through its tracker adapter. Stop.

## Blocked or too big

- **Blocked:** update only the assigned issue to `status:blocked`, comment exactly what is needed,
  push WIP, and stop. If its own timeline shows one prior execution failure, apply the
  `board-protocol.md` two-strikes rule to this issue only.
- **Too big:** do not open a PR. Comment a proposed split on the assigned issue, return only that
  issue to `status:proposed`, and stop.

## Context budget and hard boundaries

- One assigned issue means one issue and one executor invocation. Never continue to another issue.
- Do not list ready issues, inspect the board for work, calculate waves, claim work, scan unrelated
  PRs, service unrelated obligations, or invoke `/next-task`.
- Do not spawn a general-purpose executor.
- Use technical pointers and acceptance criteria as the initial search surface.
- Never read a directory when targeted search can identify files. Read ranges of large files.
- Isolate relevant failure output; do not dump complete logs. Do not reread unchanged files.
- Never merge, commit to the integration branch, force-push, or delete branches.

Return the status contract expected by the caller:
`DONE pr=#<n> branch=<name>`, `DONE_WITH_CONCERNS pr=#<n> ...`,
`BLOCKED issue=#<n> reason=<one line>`, or `TOO_BIG issue=#<n>`.
