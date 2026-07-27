# Adapter — worktrees: conductor (experimental)

Active when `raw.config.yml` → `worktrees.provider` is `conductor`. **Experimental: guidance only.**
Unlike the other providers in this directory, the exact scriptable surface here is not verified in
raw — treat every command below as something to confirm against your installed version before
trusting a run to it.

**Prerequisite:** `command -v conductor` (or the app's CLI equivalent).

## Why anyone picks it

The draw is **UI testing per worktree**: each workspace runs the app in its own environment, which
makes screenshot evidence (`evidence.ui_screenshot`) cheap and realistic — several branches running
side by side, each on its own port. That is genuinely better than sharing one dev server between
parallel workers.

## What you must solve before using it seriously

1. **Per-workspace ports.** Parallel workers each need their own dev-server port, or they will fight
   over one and the screenshots will show the wrong branch. Drive the port from the workspace (an
   env var in `commands.dev`, e.g. `PORT=$WORKSPACE_PORT npm run dev`) rather than a fixed number in
   the config.
2. **Headless launch.** raw dispatches workers non-interactively. If the only supported entry point
   is a human clicking in the app, it can't back an autonomous run — use it for the manual/UI-review
   half and keep `worktrees.provider: claude` for autopilot.
3. **Result reporting.** Like orca, there is no in-band return: the orchestrator learns outcomes from
   the tracker and the PR. Make sure a worker that dies leaves a visible trace (blocked label,
   comment) rather than silence.
4. **Gitignored files.** The per-workspace dev server is the whole reason to be here, and it won't
   boot without the env a workspace can't inherit from git. Confirm how Conductor seeds a workspace;
   whatever it does or doesn't do, `worktrees.seed_files` + the preflight in `worktrees-claude.md` →
   "Gitignored files" still works, because a workspace is a git checkout with a shared `.git`.

## Recommended posture

Use it deliberately, for UI-heavy repos, with `autopilot.parallel: 1` until the port and launch
questions above are answered for your setup. Everything else in raw is unchanged: same protocol,
same gates, same evidence gate — only where the worker runs differs.

If you get a reliable scripted flow working, that is worth writing down in this file for your repo:
this doc is a starting point, not a specification.
