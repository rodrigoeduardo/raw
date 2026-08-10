---
name: create-pr
description: Use when a task branch is ready to become a pull request, when finalizing a draft PR for review, or when asked to open a PR for current work.
---

# Create PR

Turn the current branch into a template-compliant PR. Draft-first: a draft PR should already exist from the first push; this skill finalizes it.

**REQUIRED READING:** `docs/workflow/git-conventions.md`, `raw.config.yml`, and the selected
tracker adapter when the PR closes an issue.

## Procedure

1. **Inspect reality first**: resolve the base from `git.integration_branch` (unset → repo default
   from `gh repo view --json defaultBranchRef`), then run `git log <integration-branch>..HEAD
   --oneline` and `git diff <integration-branch>...HEAD --stat`. Write the body from the real diff.

2. **Read the template at runtime**: `.github/pull_request_template.md`. Fill **every** section:
   - **Summary** — the why across all commits plus the tracker close token: GitHub → `Closes #N`;
     Linear → `Fixes <ID>` (or the exact token its adapter requires).
   - **Changes** — bullets mapping to the logical changes.
   - **Requirements coverage** — copy each acceptance criterion from the issue, check off with evidence (test name, command output, screenshot). Unmet criterion → PR stays draft; go finish it.
   - **Testing instructions** — concrete reviewer steps.
   - **Human actions needed** — env vars, migrations, secrets; "None" if none.
   - **Notes** — trade-offs; follow-ups for the planner.

3. **Create or finalize**:
   ```bash
   # no PR yet:
   gh pr create --draft --base <integration-branch> --title "type(scope): description" --body-file <body>
   # all Requirements covered:
   gh pr ready <n>
   ```
   Title = Conventional Commit style matching the dominant change.

4. If tied to a board issue, the caller (`build-issue`) moves that exact issue to
   `status:in-review` after `gh pr ready` through its tracker adapter.

## Rules

- Never mark ready with unchecked Requirements coverage.
- Never force-push. Base is the configured integration branch.
- Don't invent links or tickets — only reference what exists.
