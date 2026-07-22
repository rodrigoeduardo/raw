---
name: review-pr
description: Use when asked for an AI review of a pull request — "/review-pr 42", "review this PR" — or when a dispatcher finds a PR labeled ai-review:requested. Never self-trigger on unlabeled PRs.
---

# Review PR (AI reviewer)

Review a PR against its issue's acceptance criteria and the specs. Runs only on request (human, label, or orchestrator dispatch).

**REQUIRED READING:** `docs/workflow/review-policy.md` (verdict semantics, supplement vs replace modes). Read `raw.config.yml` for `specs_dir` (default `docs/specs`).

## Procedure

1. **Gather context**:
   ```bash
   gh pr view <n> --json title,body,labels,files
   gh pr diff <n>
   gh issue view <issue-from-Closes-#N> --json title,body
   ```
   Plus the spec sections the issue references (under `specs_dir`), and `docs/workflow/board-protocol.md`.

2. **Review against, in priority order**:
   1. Issue Requirements checklist — is each criterion actually met by the diff (not just claimed)?
   2. Spec correctness — business rules and invariants in the referenced spec sections.
   3. Scope — diff contains nothing beyond the issue's scope ("Out of scope" respected).
   4. Tests — criteria covered by tests, tests meaningful.
   5. Conventions — git-conventions.md, template compliance.

3. **Post findings** as PR comments — one problem per comment: `location: problem. suggested fix.` No praise padding, no nitpicks that don't change meaning.

4. **Verdict** — exactly one, and remove the request label:
   ```bash
   gh pr edit <n> --remove-label "ai-review:requested" --add-label "ai-review:approved"
   # or
   gh pr edit <n> --remove-label "ai-review:requested" --add-label "ai-review:changes-requested"
   ```
   `approved` = every acceptance criterion met, no blocking findings. Anything blocking → `changes-requested`.

## Rules

- Never run on a PR without a request (label, explicit ask, or orchestrator dispatch).
- Never apply or remove `ai-review:final` — human-only label.
- Never merge. Verdict is the end of this skill's job.
- Verify claims in "Requirements coverage" against the actual diff — evidence, not assertions.
