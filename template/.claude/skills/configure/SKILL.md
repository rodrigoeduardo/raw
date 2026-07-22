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
   2. **Commands** — `install`, `lint`, `test`, `test_all`, `deploy`. Free-text via "Other" when
      detection found nothing. `deploy` may stay unset (CD on default branch).
   3. **Area labels** — comma-separated list of domain areas (free text). Empty is allowed.
   4. **Specs dir** — default `docs/specs`.
   5. **Bindings** — keep `superpowers:*` defaults, or name replacement skills for the `tdd` and
      `verification` roles.
   6. **Autopilot** — `parallel` (1–3), `max_fix_cycles`.

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

## Rules

- Never overwrite `raw.config.yml` without showing the human the result (in-session diff is enough).
- Never delete existing labels; only create missing ones.
- Ask about decisions; detect facts. Don't ask what `package.json` already answers — confirm it.
