# raw

An installable agentic workflow for Claude Code, driven entirely by GitHub Issues: an AI planner proposes tasks as issues, AI builders pull them and deliver PRs, an AI reviewer checks the diffs — and **you decide which gates stay human**.

Everything is a plain file copied into your repo: skills, agent definitions, issue/PR templates, workflow docs, one config file. Small, hackable, no framework. Labels on GitHub Issues are the machine source of truth, so every state transition is auditable and any crashed agent can pick up where things left off.

## Quickstart (2-minute setup)

1. Install into your repo (copies files; skips anything that already exists):

```bash
npx github:rodrigoeduardo/raw init
```

2. In Claude Code, run `/configure`. It interviews you — human gates, project commands, area labels — writes `raw.config.yml`, and creates the GitHub labels.

3. Write your specs in `docs/specs/` (skeletons with guidance are installed), then run `/plan-board`. Approve the drafted batch and it files the issues.

4. Promote an issue to `status:ready`, then either:
   - `/next-task` — build one task, get a PR, review and merge yourself, or
   - `/autopilot` — drain the whole board: build → review → merge → deploy, as far as your gates allow.

Prerequisites: [`gh` CLI](https://cli.github.com/) authenticated, and the [superpowers](https://github.com/obra/superpowers) skills (or rebind `bindings:` in `raw.config.yml` to your own TDD/verification skills).

You can also install just the skills with [skills.sh](https://skills.sh) (`npx skills add rodrigoeduardo/raw`) — but templates, the GitHub Action, and the workflow docs still need `raw init`.

## Why this workflow exists

### #1: Agents build the wrong thing

**The problem.** Point an agent at a vague goal and it invents scope. The expensive failure isn't bad code — it's a day of plausible code for a task nobody wanted.

**The fix** is `/plan-board`. It decomposes your specs into small issues with *objectively checkable* acceptance criteria, drafts them for your approval first, and never files a duplicate. Builders are then hard-scoped to the issue's Requirements checklist — follow-up ideas go to the PR's Notes section, which the planner turns into future proposals. Scope creep has nowhere to live.

### #2: Agent sessions don't know when to stop

**The problem.** One long session tries to do planning, three tasks, and a refactor it noticed along the way. Context degrades, discipline degrades with it.

**The fix** is `/next-task`: **one task per invocation**. Claim the oldest ready issue (timestamped claim comment = concurrency lock), build it with TDD, deliver a template-compliant PR via `/create-pr`, stop. Run it by hand, in a loop, or on a schedule — the protocol is identical, and two dispatchers can't collide.

### #3: Nobody reads the AI's PRs

**The problem.** Agent PRs pile up. Rubber-stamping them defeats the point of review; reading every line doesn't scale.

**The fix** is `/review-pr` plus label semantics you control. The reviewer verifies each acceptance criterion *against the actual diff* — not the PR body's claims — and posts one problem per comment. By default its verdict is advisory (you still read and merge). Apply `ai-review:final` and an approved verdict can stand in for your read. Either way the review never merges anything.

### #4: "Fully autonomous" is a dial, not a switch

**The problem.** Most autonomous-agent setups are all-or-nothing: either you babysit every step or you hand over the keys.

**The fix** is `/autopilot` + the gate config. Three gates — **promote**, **merge**, **deploy** — each set to `human` or `auto` in `raw.config.yml` (all default `human`). Autopilot orchestrates executor and reviewer sub-agents, loops review→fix up to a cap, and goes exactly as far as your gates allow: with `merge: human` it parks approved+green PRs for your click; with everything `auto` it drains the board and deploys. `auto:hold` labels and an `AUTO-STOP` issue give you brakes at any granularity.

### #5: Workflow config scattered across prompts

**The problem.** The commands to run, the labels to use, which TDD skill to invoke — usually smeared across CLAUDE.md prose where agents half-remember them.

**The fix** is one file, `raw.config.yml`, read by every skill, written by the `/configure` interview. Swap `superpowers:test-driven-development` for your own TDD skill by editing one line — skills invoke *roles* (`bindings.tdd`), not hardcoded names.

## What gets installed

```
your-repo/
├── raw.config.yml                    # gates, commands, labels, bindings
├── CLAUDE.md                         # raw section appended (markers, idempotent)
├── .claude/
│   ├── skills/                      # autopilot, next-task, create-pr, review-pr, plan-board, configure
│   ├── agents/                      # auto-executor, auto-reviewer
│   └── settings.json                # worktree symlink config (Node default; edit for your stack)
├── .github/
│   ├── ISSUE_TEMPLATE/task.md       # board task template
│   ├── pull_request_template.md
│   └── workflows/
│       ├── pr-merged-cleanup.yml   # strips status:in-review on merge
│       └── raw-update-check.yml    # weekly: opens an issue if a newer raw is out
├── .raw-manifest.json                # per-file hash + version — powers `raw update`
└── docs/
    ├── specs/                       # skeleton spec templates (planner input)
    └── workflow/                    # board-protocol, git-conventions, review-policy
```

## Config reference (`raw.config.yml`)

| Key | Default | Meaning |
|---|---|---|
| `gates.promote` | `human` | Who moves `status:proposed → status:ready` |
| `gates.merge` | `human` | Who merges approved+green PRs (`auto` = autopilot merges) |
| `gates.deploy` | `human` | Who triggers `commands.deploy` after a merge batch |
| `commands.install/lint/test/test_all` | unset | Your stack's commands; unset = step skipped, never guessed |
| `commands.deploy` | unset | Deploy command; unset = assume CD on the default branch |
| `labels.areas` | `[]` | Domain `area:*` labels for issues |
| `specs_dir` | `docs/specs` | Planner input tree |
| `bindings.tdd` / `bindings.verification` | superpowers skills | Which skill fulfills each role — swappable |
| `autopilot.parallel` | `1` | Concurrent executors (each in its own worktree) |
| `autopilot.max_fix_cycles` | `3` | Review→fix rounds before `status:blocked` |

## CLI

```bash
npx github:rodrigoeduardo/raw init [dir] [--force] [--labels]      # install (idempotent; --force overwrites)
npx github:rodrigoeduardo/raw update [dir] [--force] [--dry-run]  # pull in upstream changes
npx github:rodrigoeduardo/raw manifest bootstrap [dir]            # enable update tracking on a pre-existing install
npx github:rodrigoeduardo/raw labels                               # create workflow labels via gh
```

CI is yours to bring — the workflow only assumes PRs have checks and the merge gate wants them green. See [`examples/ci-node-supabase.yml`](examples/ci-node-supabase.yml) for a real one.

## Staying up to date

`raw init` writes `.raw-manifest.json` — the installed version plus a content hash of every installed file. `raw update`:

- upgrades any file you haven't touched since install,
- skips (and tells you about) any file you've edited, so your customizations are never silently clobbered — pass `--force` if you want the upstream version anyway,
- always refreshes the managed block in `CLAUDE.md` (marked by `<!-- BEGIN/END:raw-workflow -->`, since that block is never meant to be hand-edited).

`--dry-run` shows exactly this plan without touching anything.

**Getting notified.** `raw-update-check.yml` (installed by default) runs weekly and opens a `status:proposed`-free, `auto:hold`-labeled issue when the repo's raw version falls behind `main` on this repo — so your board's planner/autopilot never picks it up as work, but you see it. It's pull-based (the target repo checks, nothing pushes to it); there's no hosted registry.

An install done before this existed has no `.raw-manifest.json` yet — run `raw manifest bootstrap` once (baselines current files as "unmodified," so hand-edits made before that point won't be flagged) and `update` works from then on.

Design rationale and edge-case table: [`docs/design.md`](docs/design.md).

## License

MIT
