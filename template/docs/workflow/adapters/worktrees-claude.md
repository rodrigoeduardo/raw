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

## Parallelism

`autopilot.parallel > 1` dispatches N agents in one turn, each with its own worktree. They share the
machine: fixed-port dev servers, a shared local database, and other single-instance services will
collide. Raise `parallel` only after checking the repo's own notes on that (autopilot's "Known
risks").

## Why this is the default

No external tooling, no terminal scraping, and the isolation boundary is the same one the harness
already manages. Every other provider in this directory exists to buy something this one can't do —
a visible UI per worktree, a non-Claude CLI — at the cost of a moving surface to script against.
