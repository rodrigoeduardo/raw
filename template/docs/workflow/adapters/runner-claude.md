# Adapter — runner: claude (default)

Active for any role whose `raw.config.yml` → `runners.<role>.runner` is `claude` (the default for
both `executor` and `reviewer`). The worker is a Claude Code agent that can read this repo's skills,
so the prompt stays small: name the job, point at the skill, let it read the rest.

## Config

```yaml
runners:
  executor: { runner: claude, model: sonnet, effort: medium }
  reviewer: { runner: claude, model: sonnet, effort: medium }
  babysitter: { runner: claude, model: sonnet, effort: low }
  reconciler: { runner: claude, model: opus, effort: medium }
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
`auto-reviewer` / conditional `auto-reconciler` with the mode and its inputs. The agent reads `docs/workflow/*` and
`raw.config.yml` itself — do **not** inline the workflow into the prompt; a living doc beats a copy
that ages.

Who dispatches whom: the orchestrator dispatches `auto-executor` (BUILD) and `auto-babysitter`;
the babysitter dispatches `auto-reviewer`, `auto-executor` (FIX), and — only for a batch of
substantive blocking findings — `auto-reconciler`.

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
RECONCILED pr=#<p> confirmed=<n> rebutted=<n> escalated=<n> | NEEDS_CONTEXT pr=#<p> reason=…
MERGE_READY pr=#<n> rounds=<n> rebutted=<n> inline=<n> dispatched=<n> [review=skipped-trivial]
BLOCKED pr=#<n> rounds=<n> reason=… | ESCALATE pr=#<n> threads=<n> reason=…
```

## Model tiers

CI/status/fingerprint polling is mechanical, so `runners.babysitter` defaults to sonnet/low.
Finding reconciliation (`../pr-babysit.md` §3) is the judgment call that deserves opus/medium, so
it lives in the conditional `runners.reconciler` role. No substantive blocking findings means zero
reconciler invocations; all findings for one PR round are batched into one bounded call.

The orchestrator's own model is **not** configurable from here — a skill can't switch the model of
the session it's running in. It's a launch-time choice by the human. It no longer reads diffs or CI
logs (the babysitter does, in its own context), so it can run leaner than it used to; it still has
to hold the board, the dependency graph, and the merge gate straight across a long run.
