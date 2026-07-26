# Adapter — runner: claude (default)

Active for any role whose `raw.config.yml` → `runners.<role>.runner` is `claude` (the default for
both `executor` and `reviewer`). The worker is a Claude Code agent that can read this repo's skills,
so the prompt stays small: name the job, point at the skill, let it read the rest.

## Config

```yaml
runners:
  executor: { runner: claude, model: sonnet, effort: medium }
  reviewer: { runner: claude, model: sonnet, effort: medium }
```

- **model** → the Agent-tool model override at dispatch. The agent frontmatter's `model:` is the
  fallback when nothing overrides it.
- **effort** → the agent frontmatter's `effort:` key. `/configure` syncs `runners.*` into
  `.claude/agents/auto-executor.md` / `auto-reviewer.md` so config and frontmatter can't disagree.
  When the same runner is launched as a **CLI** inside an orca/conductor terminal instead of as a
  sub-agent, effort is a flag: `claude --model <model> --effort <low|medium|high|xhigh|max>`.

## Dispatch

Sub-agent path (with `worktrees.provider: claude`): dispatch `auto-executor` / `auto-reviewer` with
the mode and its inputs. The agent reads `docs/workflow/*` and `raw.config.yml` itself — do **not**
inline the workflow into the prompt; a living doc beats a copy that ages.

The prompt carries only what isn't already written down:

- the issue or PR number and the mode (BUILD / FIX / first review / delta re-review),
- for FIX: the confirmed findings (only those — see `../pr-babysit.md` §3),
- for delta re-review: the last reviewed SHA, the previous round's blocking findings, and which
  findings were rebutted,
- run-specific facts: "the default branch already contains X from #N — REUSE it".

## Result

The agent's final status line, in-band:

```
DONE pr=#<n> branch=<name> | DONE_WITH_CONCERNS … | BLOCKED issue=#<n> reason=… | TOO_BIG issue=#<n>
APPROVED pr=#<n> | CHANGES_REQUESTED pr=#<n> blocking=<count>
```

## Orchestrator model

The orchestrator's own model is **not** configurable from here — a skill can't switch the model of
the session it's running in. It's a launch-time choice by the human, and since the orchestrator now
verifies review findings against the code (`../pr-babysit.md` §3), pick a session that can read a
diff competently rather than the cheapest one available.
