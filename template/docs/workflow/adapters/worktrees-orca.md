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
  --base-branch origin/<integration-branch> \
  --parent-worktree path:$PARENT \
  --agent claude \
  --prompt "$(cat <prompt-file>)" \
  --json
```

`<integration-branch>` = `raw.config.yml` → `git.integration_branch` (unset ⇒ the repo git default).
Never hardcode `main`: see board-protocol.md → "Integration branch".

**Write the prompt to a file and `cat` it in.** Inlining multi-KB markdown into the shell mangles it
on quoting — this is the single most common failure here.

**`--agent claude` cannot pin a model, effort, or `--dangerously-skip-permissions`.** So whenever
`runners.*` pins a model (the common case), you must use the custom-CLI path below instead — and
that path has a permissions trap documented there. Do not assume `--agent claude` runs
autonomously; if it stalls on a permission prompt, switch to the custom-CLI launch.

Forgot `--parent-worktree`? Fix it in place, without disturbing the running agent:

```bash
orca worktree set --worktree branch:<name> --parent-worktree path:$PARENT
```

## Launch — custom CLI (codex, or a pinned Claude model)

`orca worktree create --agent …` doesn't select a custom model. Create the worktree with no agent,
then create the terminal with the exact command:

```bash
worktree_id=$(orca worktree create --repo id:$REPO_ID --name <issue#>-<slug> \
  --base-branch origin/<integration-branch> --parent-worktree path:$PARENT --json | jq -r '.result.worktree.id')

# The launch command MUST make the agent non-interactive. For claude that is
# --dangerously-skip-permissions; for codex, its own non-interactive flags.
#   claude:  claude --model <sonnet|opus> --dangerously-skip-permissions
#   codex:   codex --model gpt-5.6-codex -c model_reasoning_effort="medium"
orca terminal create --worktree "id:$worktree_id" --title "<issue#>-<runner>" \
  --command "claude --model sonnet --dangerously-skip-permissions" --json >/dev/null

# Recover the handle by LISTING — do not trust a single jq path off `create`.
H=$(orca terminal list --json | jq -r \
  '.result.terminals[] | select((.worktreePath // "")|test("<name>")) | select((.title // "")|test("Claude Code")) | .handle' | head -1)

orca terminal wait --terminal "$H" --for tui-idle --timeout-ms 60000 --json >/dev/null
orca terminal send  --terminal "$H" --text "$(cat <prompt-file>)" --enter --json
```

**`--dangerously-skip-permissions` (claude) is not optional on this path.** A bare `claude` boots
*interactive* and hangs on its first `gh`/tool permission prompt — and `wait --for tui-idle` reports
that hang **identically to "finished"**, so the send lands in a frozen TUI and the worker silently
does nothing. This is the sibling of the "idle = CLI exited" gotcha below: with a custom-CLI launch,
`tui-idle` also means "possibly waiting on a prompt." Always launch with permissions bypassed, and
confirm the boot banner (`claude terminal read` → look for the model line) before relying on idle.

**Getting the terminal handle.** `orca terminal create --json` does not reliably expose the handle
at `.result.handle` (it was empty across a whole run). List and filter instead, as above. Two jq
traps: use `(.title // "")` and `(.worktreePath // "")` — a terminal with a `null` title/path
otherwise aborts the whole `jq test()` with an error.

`wait --for tui-idle` before `send` is still required: sending into a TUI mid-boot drops the prompt.

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

**Detect completion from observable state, not by scraping the terminal tail.** The tail echoes the
*entire prompt you sent* — including its own report-format templates (`DONE pr=#<n>`,
`ESCALATE pr=#<p> threads=<n>`, `TOO_BIG issue=EST-8`). A naïve `grep` for those keywords matches
the echoed template and fires a false "the worker is done" — this cost several wasted turns in the
first run. Prefer, in order:

1. **The GitHub PR** — an executor's real completion is a PR. But it opens a **draft** PR early and
   finalizes it later, so *a PR existing is not "done"*: gate on `isDraft == false`
   (`gh pr view <n> --json isDraft`), not mere existence.
2. **The tracker state** — a real `In Review` / `Blocked` transition (Linear) is a truthful signal a
   template echo can't fake.
3. **Terminal text only as a last resort**, and then anchor hard: require the keyword immediately
   after leading whitespace and **reject any line containing a backtick** (the templates are inside
   `` `…` ``), e.g. `grep -E '^[[:space:]]*(⏺ )?(DONE|BLOCKED|TOO_BIG)([[:space:]]|$)' | grep -v '\`'`.

**Reap child worktrees you spawned.** A babysitter's `auto-reviewer` and FIX `auto-executor` leave
their worktrees behind — sub-agents deliberately do **not** delete worktrees unasked. The
orchestrator reaps every child worktree for a PR once that PR merges:
`orca worktree rm --worktree "name:<name>" --force`. Confirm none linger with `orca worktree list`.

## Waiting for completion — sentinel + Monitor, not sleep-poll bash loops

Orca workers run as independent CLI processes outside the harness's task tracker (unlike
`worktrees.provider: claude`, where the Agent tool gives free push-notify on completion). There is
no orca→orchestrator callback. Don't default to `run_in_background` bash loops with `sleep` —
long-lived bash watchers get reaped (observed twice on a ~600-line EST-10 build; short-lived ones
survived).

**Do this instead:**

1. Add one line to every worker prompt: after the report line, write a sentinel with the actual
   outcome, not just presence — `echo "DONE pr=#<n>" > $CLAUDE_JOB_DIR/tmp/done-<issue#>` (or
   `FAILED`/`BLOCKED`, whatever the report format is). Existence-only sentinels are a false-positive
   risk if some other write touches that path.
2. Orchestrator runs a **persistent `Monitor`** (`persistent: true`) tailing that file. This is
   event-driven and near-zero latency — but it is still a poll dressed as push, and it can itself get
   reaped, same failure mode as the bash loops it replaces.
3. Always pair it with a **`ScheduleWakeup` fallback**, delay matched to observed build duration
   (~10–13 min → schedule ~15 min out). This is the reap-proof backstop, not the primary path. If the
   Monitor fires normally, cancel/ignore the pending wakeup.

**Tradeoffs — this is not free:**

- Extra prompt-discipline burden: every worker prompt must include the sentinel line, or the
  orchestrator has zero signal and waits for the fallback wakeup (full delay, e.g. 15 min) before
  noticing anything.
- Monitor reap risk isn't eliminated, just made less likely than a bash loop — the wakeup fallback is
  what actually bounds worst-case latency, and that bound is the full wakeup interval, not "near
  zero."
- `orca terminal wait --for tui-idle` as a blocking alternative ties up a bash slot for the whole
  build and shares the "idle looks like done" ambiguity from the launch section above — it still
  needs the sentinel to disambiguate real completion from a stalled/interactive-hung terminal.
- No option here is a true push from orca into the orchestrator's session. All of them are
  cheap-poll-vs-reap-risk-vs-complexity tradeoffs, not a fix for the missing callback.

## Gitignored files (`worktrees.seed_files`)

Orca worktrees are git worktrees, so they inherit the same gap: no `.env.local`, no dev server, and
the evidence gate blocks. **`.worktreeinclude` does not help here** — Claude Code applies it in its
own worktree-creation path, which orca doesn't go through. So under this provider `seed_files` is
the mechanism, not the fallback: list every gitignored path the dev server and test suite need.

The preflight procedure and its rules are in `worktrees-claude.md` → "Gitignored files —
`worktrees.seed_files`". Note that `$PARENT` above is the primary checkout only on a top-level run;
the worker should resolve its own source with `git rev-parse --git-common-dir` rather than trusting
a lineage parent, which may itself be another worker's worktree.

## Gotchas

- `--base-branch origin/<integration-branch>` for every worker (`git.integration_branch`, default =
  repo git default) — children of a fresh integration branch, never of the parent worktree's branch.
  No stacked branches. Never hardcode `main`.
- Repo id comes from `orca worktree current --json`; hardcoding it breaks on the next machine.
- A terminal that shows `tui-idle` immediately after `create` usually means the CLI exited — read the
  terminal output before assuming the agent is working.
