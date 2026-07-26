# Adapter — runner: codex

Active for any role whose `raw.config.yml` → `runners.<role>.runner` is `codex` — typically
`adversarial_reviewer` (a second opinion from a different model family), sometimes `executor`.

**Prerequisite:** `command -v codex`. `/configure` checks before offering it.

```yaml
runners:
  executor: { runner: codex, model: gpt-5.6-codex, effort: medium }
  adversarial_reviewer: { runner: codex, model: gpt-5.6-codex, effort: medium }
  codex_command: codex exec
```

## The core constraint: no skills

A codex worker **cannot read this repo's Claude skills**. Everything a Claude worker would look up —
board protocol, git conventions, the PR template, the status-line contract — has to be *in the
prompt*. So the orchestrator writes a **self-contained prompt file** per dispatch, and passes it by
file (never inline: multi-KB markdown in a shell argument gets mangled).

The prompt file contains:

1. **The full issue spec** — goal, requirements checklist, expected behavior, test scenarios,
   technical notes, out of scope, human actions. Inline it; the worker should not need to fetch the
   tracker to know what to build.
2. **The standing workflow**, inlined (this is what the skills would have told a Claude worker):
   > 1. Branch off the fresh default branch as `type/<issue#>-<slug>`.
   > 2. Write a failing test first, then implement until it passes. Tests ship with the behavior.
   > 3. Run `<commands.install>`, `<commands.lint>`, `<commands.test_all>` — all green before you
   >    hand off; fix everything red, including anything you didn't cause.
   > 4. Commit on the fly, Conventional Commits, atomic, never force-push, never commit to the
   >    default branch.
   > 5. Push and open a **draft** PR targeting the default branch, body filled per the PR template
   >    sections: Summary (with `Closes #N`), Changes, Requirements coverage (each criterion with
   >    evidence), Testing instructions, Human actions needed, Notes. Mark it ready only when every
   >    criterion is covered.
   > 6. [when the evidence gate is active] Run the app with `<commands.dev>`, drive the flow,
   >    attach a screenshot to the PR. No `commands.dev` → stop and report BLOCKED.
   > 7. **Do not merge.** Stop once the PR is open and its checks are green (or your fix is pushed
   >    and the run is pending).
   > 8. Print exactly one final status line: `DONE pr=#<n> branch=<name>` /
   >    `BLOCKED issue=#<n> reason=<one line>` / `TOO_BIG issue=#<n>`.
3. **Run-specific facts** — e.g. "the default branch already contains X from #N — REUSE it, do not
   reimplement."

Keep the file in the scratchpad, one per dispatch.

## Execution

**With `worktrees.provider: claude`** — the orchestrator creates the worktree and runs codex headless
in the background:

```bash
git worktree add <path> -b <type>/<issue#>-<slug> origin/<default-branch>
cd <path> && <runners.codex_command> --model <model> -c model_reasoning_effort="<effort>" \
  --prompt-file <prompt-file>     # or the equivalent your codex version accepts
```

Parse the **trailing status line** from its output; everything else is noise. A non-zero exit or a
missing status line is a **launch failure** (infrastructure) — relaunch is fine and it is not a
strike under the two-strikes rule.

**With `worktrees.provider: orca`** — use the terminal flow in `worktrees-orca.md` (create worktree
without an agent, `terminal create --command "codex …"`, `wait --for tui-idle`, `terminal send
--text "$(cat <prompt-file>)"`).

## As a reviewer

A codex reviewer **prints** its findings and a verdict; it does not touch GitHub state:

- The **orchestrator** posts the findings as PR comments and, for the primary reviewer role, applies
  the verdict label. Label authority stays in exactly one place, whatever ran the review.
- As `adversarial_reviewer`, its findings are comments only — no label, ever. Raw's reviewer owns
  the verdict; the value here is a **decorrelated** second look, not a second vote.
- Either way, findings go through reconciliation (`../pr-babysit.md` §3) before becoming work.

## Gotchas

- **Model/flag rejection**: if the CLI rejects the model or reasoning-effort flag, stop and surface
  the exact error. Never silently fall back to another model — a run whose model you can't name is
  not reproducible.
- **Prompt drift**: the inlined standing workflow is a copy of the docs. When you change
  `git-conventions.md` or the PR template, update this file too, or codex workers will keep
  following last month's rules.
- **Don't half-inline**: a prompt that says "follow docs/workflow/board-protocol.md" to a worker that
  can't read skills but *can* read files is a coin flip. Either inline it or state the file path
  explicitly as a read instruction.
