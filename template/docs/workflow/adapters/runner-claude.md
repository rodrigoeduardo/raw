# Adapter — runner: claude (default)

Active for any role whose `raw.config.yml` → `runners.<role>.runner` is `claude` (the default for
both `executor` and `reviewer`). The worker is a Claude Code agent that can read this repo's skills,
so the prompt stays small: name the job, point at the skill, let it read the rest.

## Config

```yaml
runners:
  executor: { runner: claude, model: sonnet, effort: medium }
  reviewer: { runner: claude, model: sonnet, effort: medium }
  babysitter: { runner: claude, model: opus, effort: medium }
```

- **model** → the Agent-tool model override at dispatch. The agent frontmatter's `model:` is the
  fallback when nothing overrides it.
- **effort** → the agent frontmatter's `effort:` key. `/configure` syncs `runners.*` into
  `.claude/agents/auto-executor.md` / `auto-reviewer.md` / `auto-babysitter.md` so config and
  frontmatter can't disagree.
  When the same runner is launched as a **CLI** inside an orca/conductor terminal instead of as a
  sub-agent, effort is a flag: `claude --model <model> --effort <low|medium|high|xhigh|max>`.

## Dispatch

Sub-agent path (with `worktrees.provider: claude`): dispatch `auto-executor` / `auto-babysitter` /
`auto-reviewer` with the mode and its inputs. The agent reads `docs/workflow/*` and
`raw.config.yml` itself — do **not** inline the workflow into the prompt; a living doc beats a copy
that ages.

Who dispatches whom: the orchestrator dispatches `auto-executor` (BUILD) and `auto-babysitter`;
the babysitter dispatches `auto-reviewer` and `auto-executor` (FIX) for its own PR.

The prompt carries only what isn't already written down:

- the issue or PR number and the mode (BUILD / FIX / dispatched / first review / delta re-review),
- for FIX: the confirmed findings (only those — see `../pr-babysit.md` §3),
- for delta re-review: the last reviewed SHA, the previous round's blocking findings, and which
  findings were rebutted,
- run-specific facts: "the default branch already contains X from #N — REUSE it".

## Result

The agent's final status line, in-band:

```
DONE pr=#<n> branch=<name> | DONE_WITH_CONCERNS … | BLOCKED issue=#<n> reason=… | TOO_BIG issue=#<n>
APPROVED pr=#<n> | CHANGES_REQUESTED pr=#<n> blocking=<count>
MERGE_READY pr=#<n> rounds=<n> rebutted=<n> inline=<n> dispatched=<n> [review=skipped-trivial]
BLOCKED pr=#<n> rounds=<n> reason=… | ESCALATE pr=#<n> threads=<n> reason=…
```

## Model tiers

Finding reconciliation (`../pr-babysit.md` §3) is the judgement call this workflow hangs on:
deciding whether a review finding actually reproduces, before paying a fix round for it. It lives
in the **babysitter**, which is why `runners.babysitter` defaults to opus while the executor and
reviewer default to sonnet. Those two do bounded work against a written spec — build to the
acceptance criteria, judge a diff against them — and a cheaper model does it fine.

The orchestrator's own model is **not** configurable from here — a skill can't switch the model of
the session it's running in. It's a launch-time choice by the human. It no longer reads diffs or CI
logs (the babysitter does, in its own context), so it can run leaner than it used to; it still has
to hold the board, the dependency graph, and the merge gate straight across a long run.
