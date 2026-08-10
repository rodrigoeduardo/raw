---
name: configure
description: Use to set up or change the raw workflow configuration — human gates, area labels, project commands, sub-skill bindings — via an interactive interview that writes raw.config.yml and can create GitHub labels.
---

# Configure (workflow setup)

Interactive setup for the raw workflow. Interview the human with the question UI (AskUserQuestion —
one small batch of questions at a time), then write `raw.config.yml` and optionally create GitHub
labels. Idempotent: re-runs load current values and offer them as defaults.

## Procedure

1. **Load current state.** Read `raw.config.yml` if present (else start from the documented
   defaults). Detect what you can instead of asking:
   - Repo: `gh repo view --json owner,name,defaultBranchRef`.
   - Candidate commands: read `package.json` scripts / `Makefile` / `justfile` if present and offer
     them as suggested answers — still confirm with the human, never silently guess.
   - Existing labels: `gh label list --limit 200`.

2. **Interview** (use AskUserQuestion; current/detected values as recommended options):
   1. **Gates** — `promote`, `merge`, `deploy`: human or auto each. Explain the consequence in one
      line per option (e.g. merge=auto → `/autopilot` merges approved+green PRs without you).
   2. **Commands** — `install`, `lint`, `test`, `test_all`, `deploy`, `dev`. Free-text via "Other"
      when detection found nothing. `deploy` may stay unset (CD on default branch). Ask for `dev`
      (how to run the app locally) whenever the evidence gate can activate — i.e. unless
      `evidence.ui_screenshot` is `off` — because a gated issue with no `commands.dev` blocks.
   3. **Area labels** — comma-separated list of domain areas (free text). Empty is allowed.
   4. **Specs dir** — default `docs/specs`.
   5. **Bindings** — keep `superpowers:*` defaults, or name replacement skills for the `tdd` and
      `verification` roles.
   6. **Autopilot** — `parallel` (1–3), `max_fix_cycles`.
   7. **Advanced (offer, don't push)** — ask once: "configure pluggability (tracker, worktrees,
      runners, evidence gate)?" Default answer is no; every default is raw's current behavior. If
      yes, run the advanced interview below.

3. **Write `raw.config.yml`.** Preserve the comment structure of the shipped template (comments are
   the config's documentation). Show the resulting file to the human.

4. **Offer label creation.** If the human accepts, create idempotently
   (`2>/dev/null || true` on each, or check `gh label list` first):
   ```bash
   gh label create "status:proposed"       --color BFD4F2 --description "Awaiting promotion"
   gh label create "status:ready"          --color 0E8A16 --description "Claimable by a builder"
   gh label create "status:in-progress"    --color FBCA04 --description "Claimed by a builder"
   gh label create "status:in-review"      --color 5319E7 --description "PR open, awaiting review/merge"
   gh label create "status:blocked"        --color B60205 --description "Stuck — see issue comment"
   gh label create "ai-review:requested"   --color C2E0C6 --description "AI review requested"
   gh label create "ai-review:approved"    --color 0E8A16 --description "AI verdict: criteria met"
   gh label create "ai-review:changes-requested" --color D93F0B --description "AI verdict: issues found"
   gh label create "ai-review:final"       --color 1D76DB --description "Human pre-authorizes AI approval (human-only)"
   gh label create "human-action-needed"   --color B60205 --description "Human steps pending — not claimable"
   gh label create "auto:hold"             --color EEEEEE --description "autopilot: skip this issue/PR"
   ```
   Plus one `area:<name>` label per configured area.

5. **Report.** Print what changed (config diff, labels created) and the next step: `/plan-board` to
   populate the board, then `/next-task` or `/autopilot`.

## Advanced interview (pluggability)

Only when the human opted in at step 2.7. Each block: **check the prerequisite first, then ask** —
never offer a provider whose tooling isn't installed, and never write a config the session can't
execute. Read the adapter doc for whatever gets selected before writing anything.

1. **Tracker** (`tracker.provider`: `github` | `linear`) — `docs/workflow/adapters/`.
   - Prerequisite for `linear`: the Linear MCP server is reachable in this session (try a cheap call
     such as listing teams). Unreachable → say so and keep `github`.
   - On `linear`: ask for the team key, then map each raw status to a real workflow state. Fetch the
     team's actual states and offer them as options — do not free-text guess names. No "Blocked"
     state → offer to create one, or fall back to the `raw:blocked` label (write that choice into
     the config comment).
   - Remind the human that `ai-review:*` labels stay on GitHub PRs regardless.
2. **Worktrees** (`worktrees.provider`: `claude` | `orca` | `conductor`).
   - Prerequisite: `command -v orca` / `command -v conductor`. Missing → not offered.
   - `conductor` is **experimental** (guidance doc, unverified surface) — say so when offering it.
   - **Gitignored files a worktree needs** — ask whenever `commands.dev` is set and
     `evidence.ui_screenshot` isn't `off`; that combination is where a missing env file blocks a
     worker. Propose only paths that are gitignored *and* present (`git status --ignored --short`,
     or `git check-ignore -v .env.local .env …`) — never one that is tracked, never one that isn't
     there. Then write them to whichever mechanism the provider uses:
     - `claude` with a Claude executor → add them to `.worktreeinclude` and leave `seed_files`
       empty; Claude Code applies that file at worktree creation. The installed default already
       lists `.env.local` and `.env.*.local`, so often there is nothing to do.
     - `claude` with a Codex executor → `worktrees.seed_files`; its explicit Git worktree does not
       pass through Claude Code's `.worktreeinclude` mechanism.
     - `orca` / `conductor` → `worktrees.seed_files`; those providers never read `.worktreeinclude`.
     - Either provider, when a missing path should stop the worker with a named reason rather than
       fail later as a dead dev server → `worktrees.seed_files`.
3. **Runners** (`runners.executor`, `runners.reviewer`, `runners.babysitter`, `runners.reconciler`,
   `runners.adversarial_reviewer`).
   - Prerequisite for `codex`: `command -v codex`. Missing → only `claude` is offered.
   - Per role ask: runner, model, effort (`low|medium|high|xhigh|max`).
   - If the executor changes between Claude and Codex after the gitignored-file question, re-check
     that those paths use the mechanism required by the selected combination above.
   - `babysitter` defaults to sonnet/low for mechanical CI/status/fingerprint work.
     `reconciler` defaults to opus/medium and is invoked only when substantive blocking findings
     need judgment; batch all findings from one round into one call.
   - `adversarial_reviewer` is opt-in and off by default; explain it in one line — a second reviewer
     from another model family posts findings as PR comments for decorrelated errors, and raw's
     reviewer still owns the verdict label.
   - **Sync claude runner settings into the agent definitions**: after writing the config, update
     `.claude/agents/auto-executor.md`, `.claude/agents/auto-reviewer.md`,
     `.claude/agents/auto-babysitter.md`, and `.claude/agents/auto-reconciler.md` frontmatter
     (`model:`, `effort:`) to match `runners.*`. The
     frontmatter is the fallback when nothing overrides it; a config that disagrees with it is a
     silent lie.
4. **Evidence gate** (`evidence.ui_screenshot`: `auto` | `required` | `off`).
   - Explain `auto` in one line: required only for issues marked user-visible, inert for headless
     repos. Recommend `auto`.
   - If the answer is not `off` and `commands.dev` is unset, ask for it now (go back to the commands
     block) — the gate BLOCKS issues when it can't run the app.
   - Then ask **`evidence.driver`** (`playwright` | `manual`), unless `ui_screenshot` is `off`.
     Recommend `playwright` — it's the documented, repeatable path
     (`docs/workflow/adapters/evidence-playwright.md`); `manual` means the worker improvises, and is
     for stacks Playwright can't drive.
     Prerequisite check before recommending it: run `npx playwright --version` in the target repo.
     Failure → say plainly that every gated issue will BLOCK until the CLI is available. Let the
     human choose it anyway (installing Playwright later is normal) or pick `manual`; never silently
     downgrade the setting. Browser-tool availability elsewhere in the session is not sufficient,
     because executors use this bounded CLI contract.

## Rules

- Never overwrite `raw.config.yml` without showing the human the result (in-session diff is enough).
- Never delete existing labels; only create missing ones.
- Ask about decisions; detect facts. Don't ask what `package.json` already answers — confirm it.
- Never write a provider into the config without checking its prerequisite first — an unreachable
  MCP server or a missing CLI turns every later run into a launch failure.
- Don't drag the human through the advanced interview by default. Defaults = today's behavior.
