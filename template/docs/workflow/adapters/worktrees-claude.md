# Adapter — worktrees: claude (default)

Active when `raw.config.yml` → `worktrees.provider` is `claude` (or unset). Workers run as Claude
Code sub-agents in an isolated git worktree created by the Agent tool itself.

## How a worker is launched

Dispatch the agent (`auto-executor` / `auto-reviewer`) with `isolation: worktree` — it is already in
their frontmatter, so the orchestrator just dispatches. The harness creates the worktree, runs the
agent inside it, and returns the agent's final message.

- **Result comes back in-band**: the agent's last line is its status line
  (`DONE pr=#<n> branch=<name>`, `BLOCKED …`, `TOO_BIG …`, `APPROVED …`, `CHANGES_REQUESTED …`).
  The orchestrator branches on that string; nothing needs parsing out of a terminal.
- **Model/effort** come from `runners.executor` / `runners.reviewer` (agent frontmatter is the
  fallback) — see `runner-claude.md`.
- **Cleanup** is the harness's: an unchanged worktree is removed automatically.

## Shared dependencies

Fresh worktrees start without `node_modules` (or your stack's equivalent). Two options, both fine:

- `.claude/settings.json` → `worktree.symlinkDirectories` (installed default: `node_modules`), so a
  new worktree reuses the parent's install; or
- let the worker run `commands.install` in its preflight.

## Gitignored files (`worktrees.seed_files`)

A worktree is a checkout of tracked files only. Gitignored ones — `.env.local` above all — are **not**
inherited, so `commands.dev` and any env-dependent test fails in a fresh worktree while passing in
the primary checkout. `symlinkDirectories` doesn't cover this: it takes directories, not files.

There is no post-create setup hook to lean on either. Claude Code's `WorktreeCreate` hook *replaces*
worktree creation (it must create the directory and echo its path — it exists for non-git VCS), so
using it to seed env would mean owning worktree creation for every dispatch. Seeding is therefore
raw's own preflight step, driven by `raw.config.yml` → `worktrees.seed_files`.

**Preflight procedure** (step 2 of `auto-executor`; empty or unset list = skip entirely):

```bash
# The primary repo's .git is shared by every linked worktree, so its parent is
# the primary root — no path has to be passed in by the orchestrator.
PRIMARY=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")

# For each entry in worktrees.seed_files:
[ -e "<path>" ] && continue                     # worktree already has one — never clobber it
[ -e "$PRIMARY/<path>" ] || exit_blocked        # see below
mkdir -p "$(dirname "<path>")"
cp "$PRIMARY/<path>" "<path>"
```

Rules the worker does not get to bend:

- **Source is the primary repo root only.** Never another agent's worktree — parallel workers hold
  half-written state, and a sibling's env is not a contract.
- **Missing at the source → `BLOCKED: worktrees.seed_files entry <path> not found at the primary
  repo root`.** Never synthesize an env file, and never fill a value in to get past a failing test.
- **Never staged.** These paths are gitignored, so they stay out of the diff by construction; if one
  turns up in `git status`, it isn't ignored and doesn't belong in `seed_files`.
- **Delete before reporting status.** Every dispatch re-seeds, and a worktree that produced commits
  is not auto-removed by the harness — leaving credentials in it is the failure mode.

## Parallelism

`autopilot.parallel > 1` dispatches N agents in one turn, each with its own worktree. They share the
machine: fixed-port dev servers, a shared local database, and other single-instance services will
collide. Raise `parallel` only after checking the repo's own notes on that (autopilot's "Known
risks").

## Why this is the default

No external tooling, no terminal scraping, and the isolation boundary is the same one the harness
already manages. Every other provider in this directory exists to buy something this one can't do —
a visible UI per worktree, a non-Claude CLI — at the cost of a moving surface to script against.
