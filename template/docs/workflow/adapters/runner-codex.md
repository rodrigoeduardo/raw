# Adapter — runner: codex

Active for any role whose `raw.config.yml` → `runners.<role>.runner` is `codex` — commonly the
executor or adversarial reviewer, and optionally the conditional reconciler.

**Prerequisite:** `command -v codex`. `/configure` checks before offering it.

```yaml
runners:
  executor: { runner: codex, model: gpt-5.6-codex, effort: medium }
  adversarial_reviewer: { runner: codex, model: gpt-5.6-codex, effort: medium }
  codex_command: codex exec
```

## Project skills are available

Modern Codex discovers project skills under `.agents/skills`. RAW installs
`.agents/skills -> ../.claude/skills`, leaving `.claude/skills` canonical; this source repository
uses `.agents/skills -> ../template/.claude/skills`. A Codex worker can therefore invoke RAW skills
without copied workflow text.

Do not build giant self-contained prompts. The dispatch should name the skill, one job, and only
run-specific facts. The worker reads the living skill and adapter docs from the checkout.

## Execution over stdin

All provider combinations use the installed `.claude/scripts/run-codex.mjs` bridge. It reads the
narrow prompt from its own stdin (or a one-use input file), starts the configured command with the
model and effort flags, writes the prompt to `codex exec -`, and closes stdin. This is an executable
contract covered by the runner matrix tests, not a prompt-delivery convention each caller recreates.

```bash
printf '%s\n' '<narrow prompt>' | node .claude/scripts/run-codex.mjs \
  --model <model> --effort <effort> -- <runners.codex_command>
```

Text after `--` is the configured command argv (`codex exec` by default). Do not rely on an
undocumented Codex prompt-file option or interpolate prompt text into a shell argument.

### BUILD

The issue is already selected and claimed. A normal prompt is deliberately small:

```text
Use $build-issue to build the already claimed issue <ID>.
Do not select or inspect other work. Stop after delivering this issue.
<run-specific reuse fact, only when present>
```

`$build-issue` fetches the exact issue, loads targeted implementation context, performs TDD and
verification, captures bounded CLI evidence when required, finalizes the PR, and stops.

### FIX

Pass the PR number/branch and only confirmed findings or the exact CI/sync reason. Tell Codex to
follow the FIX boundaries in `.claude/agents/auto-executor.md`, verify, push without force, print
the expected status line, and stop. It must not rediscover findings or unrelated work.

### Reconciliation

Invoke only when substantive blocking findings exist. Send one batch containing the relevant diff,
acceptance criteria, findings, and targeted excerpts; point at
`.claude/agents/auto-reconciler.md`. The worker is read-only and returns confirmed/rebutted/escalated
classifications. No findings means no invocation.

The reconciliation status contract also permits
`NEEDS_CONTEXT pr=#<p> reason=<one line>`. That is terminal for this bounded invocation: the caller
maps it to human escalation and does not launch a second reconciler to repair its own input package.

Parse the trailing status line from output. A non-zero exit or missing status line is a launch
failure (infrastructure), not an execution strike.

For `worktrees.provider: claude`, use the explicit Git worktree path in `worktrees-claude.md`; the
Claude Agent tool cannot launch a Codex process. For `worktrees.provider: orca`, use the terminal
path in `worktrees-orca.md`. Both call the same bridge and neither leaves a persistent prompt
artifact.

## As a reviewer

A Codex reviewer prints findings and a verdict; it does not touch GitHub state:

- The orchestrator posts findings and, for the primary reviewer role, applies the verdict label.
- As `adversarial_reviewer`, findings are comments only; RAW's reviewer owns the verdict.
- Findings still pass through conditional reconciliation before becoming fix work.

## Gotchas and deliberate scope

- **Model/flag rejection:** surface the exact error. Never silently fall back to another model.
- **Skill-link conflict:** if `.agents/skills` is a real user-owned directory or points elsewhere,
  `raw init/update` preserves it and reports the conflict. Resolve it explicitly before expecting
  RAW skill discovery.
- **Custom Codex agents deferred:** this refactor does not mirror Claude agent Markdown into
  `.codex/agents/*.toml`; their schemas differ. Project skill discovery plus narrow runner prompts
  provides compatibility without a second agent architecture to maintain.
