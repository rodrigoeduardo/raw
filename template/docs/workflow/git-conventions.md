# Git Conventions

These apply **at all times**, to agents and humans alike — not only at task completion.

## Commits — on the fly, atomic

- Commit as soon as a coherent change exists. Do not batch a whole task into end-of-task commits.
- An atomic commit:
  - does exactly one thing, describable in one sentence;
  - leaves the codebase working (build/tests would pass);
  - never mixes concerns (no formatting + logic in one commit, no two unrelated fixes).
- Group changes by **intent**, not by file. If a diff touches files for two reasons, that's two commits.
- Run `git status` and `git diff` before staging. Stage deliberately — use `git add -p` when a single file mixes concerns. Never `git add -A` / `git add .` blindly.

## Commit messages — Conventional Commits

```
type(scope): short imperative description
```

- `type`: `feat` | `fix` | `refactor` | `style` | `chore` | `docs` | `test` | `config`
- `scope` (optional): the area or component touched — e.g. `(auth)`, `(db)`, `(billing)`
- Description: lowercase, imperative mood ("add", "fix", "handle" — not "added"/"fixes"), no trailing period
- Body only when the **why** isn't obvious from the diff. Explain intent, don't restate the diff.

Examples:

```
feat(auth): add password reset request form
fix(billing): round invoice totals to two decimals
docs(workflow): clarify stale-claim takeover rule
```

## Branches

- Never commit directly to the default branch (`main` below; substitute yours).
- Naming: `type/<issue-number>-<kebab-slug>` when tied to a board issue — e.g. `feat/23-user-signup-form`, `fix/31-invoice-rounding`. Without an issue: `type/<kebab-slug>`.
- Branch off fresh `main`.

## Pushes and PRs

- Push the task branch early (`git push -u origin <branch>`) and open a **draft PR** after the first push — progress stays visible.
- Finalize PRs only via the `/create-pr` skill (fills the PR template from the actual diff).
- Never force-push. Never delete branches without explicit human confirmation.
