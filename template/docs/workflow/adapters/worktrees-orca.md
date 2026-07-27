# Adapter — worktrees: orca

Active when `raw.config.yml` → `worktrees.provider` is `orca`. Each worker gets an Orca child
worktree with a real terminal running a CLI agent — which is what makes it possible to run a
**non-Claude runner** (see `runner-codex.md`) or watch a worker's terminal while it works.

**Prerequisite:** `command -v orca`. `/configure` checks this before offering the provider.

## Resolve context once per run

```bash
REPO_ID=$(orca worktree current --json | jq -r .repoId)   # never hardcode
PARENT=$(orca worktree current --json | jq -r .path)      # this worktree = lineage parent
git fetch origin                                          # so children include merged blockers
```

**Always `git fetch` before cutting a worktree for an issue whose blocker just merged.** Cutting off
a stale default branch omits the blocker's code, and the worker will either fail or reimplement it.
Verify with `git log origin/<default-branch> --oneline -1`.

## Launch — Claude runner

```bash
orca worktree create \
  --repo id:$REPO_ID \
  --name <issue#>-<slug> \
  --base-branch origin/<default-branch> \
  --parent-worktree path:$PARENT \
  --agent claude \
  --prompt "$(cat <prompt-file>)" \
  --json
```

**Write the prompt to a file and `cat` it in.** Inlining multi-KB markdown into the shell mangles it
on quoting — this is the single most common failure here.

Forgot `--parent-worktree`? Fix it in place, without disturbing the running agent:

```bash
orca worktree set --worktree branch:<name> --parent-worktree path:$PARENT
```

## Launch — custom CLI (codex, or a pinned Claude model)

`orca worktree create --agent …` doesn't select a custom model. Create the worktree with no agent,
then create the terminal with the exact command:

```bash
worktree_id=$(orca worktree create --repo id:$REPO_ID --name <issue#>-<slug> \
  --base-branch origin/<default-branch> --parent-worktree path:$PARENT --json | jq -r .id)

terminal_handle=$(orca terminal create \
  --worktree id:$worktree_id \
  --title "<issue#>-<runner>" \
  --command "<runner command from runners.*, e.g. codex --model gpt-5.6-codex -c model_reasoning_effort=\"medium\">" \
  --json | jq -r .handle)

orca terminal wait --terminal "$terminal_handle" --for tui-idle --timeout-ms 60000 --json
orca terminal send  --terminal "$terminal_handle" --text "$(cat <prompt-file>)" --enter --json
```

`wait --for tui-idle` before `send` is not optional: sending into a TUI that hasn't finished booting
drops the prompt silently.

If the CLI rejects the model or a flag, **stop and surface the exact error** — never silently fall
back to another model. That is a launch failure (infrastructure), so it doesn't count as a strike
under the two-strikes rule.

## Reading results

Unlike the claude provider, there is no in-band return value: the worker reports by **doing the work
on GitHub** (branch, draft PR, status line printed in its terminal). The orchestrator learns the
outcome from the tracker and the PR, not from a function result. Record the worktree id and terminal
handle per issue so you can inspect a stalled worker, and confirm spawns with:

```bash
orca worktree ps        # each new worktree should show live:1 pty:yes
```

## Gitignored files (`worktrees.seed_files`)

Orca worktrees are git worktrees, so they inherit the same gap: no `.env.local`, no dev server, and
the evidence gate blocks. The preflight procedure and its rules are provider-independent — follow
`worktrees-claude.md` → "Gitignored files". `$PARENT` above is the primary checkout only on a
top-level run; the worker should resolve its own source with `git rev-parse --git-common-dir` rather
than trusting a lineage parent, which may itself be another worker's worktree.

## Gotchas

- `--base-branch origin/<default-branch>` for every worker — children of a fresh default branch,
  never of the parent worktree's branch. No stacked branches.
- Repo id comes from `orca worktree current --json`; hardcoding it breaks on the next machine.
- A terminal that shows `tui-idle` immediately after `create` usually means the CLI exited — read the
  terminal output before assuming the agent is working.
