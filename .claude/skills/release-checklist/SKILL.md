---
name: release-checklist
description: Use after finishing a change to this raw repo (new/changed config keys, CLI commands, template files, or workflow behavior) and before considering the work done — checks whether README.md and package.json version need updating alongside the change.
---

# Release checklist (raw repo only)

This repo ships itself as `raw-workflow` via `npx github:rodrigoeduardo/raw`. Nothing enforces that
docs and version stay in sync with the code — this skill is that check. Run it right before the
final commit of a change, not as a separate pass later.

## Procedure

1. **Diff the change.** `git diff` (staged + unstaged) or `git show HEAD` if already committed.
   Look specifically for:
   - New or renamed keys in `template/raw.config.yml`.
   - New CLI subcommands/flags in `bin/cli.mjs`.
   - New files under `template/` that a user would need to know exist (new skill, new agent, new
     adapter doc).
   - Behavior changes to `raw init` / `raw update` / `raw manifest`.

2. **Update `README.md` if the diff touched any of the above:**
   - New/changed `raw.config.yml` key → add or edit its row in the `## Config reference` table
     (keep the `| Key | Default | Meaning |` format, one line each).
   - New CLI subcommand/flag → update the `## CLI` code block.
   - New template file meant to be user-visible → mention it where the repo tree or feature list is
     described.
   - Skip this step only if the diff is internal (refactor, test, comment) with no user-visible
     surface change.

3. **Bump `package.json` version** (semver, no tags are cut for this repo — just keep it moving):
   - New capability/config key/CLI feature → minor (`0.x.0 → 0.(x+1).0`).
   - Bug fix, doc-only fix, no new surface → patch (`0.x.y → 0.x.(y+1)`).
   - Breaking change to config schema or CLI behavior → call it out explicitly to the human before
     bumping; don't silently pick major vs minor.
   - Skip only for a pure docs/comment change with zero functional diff.

4. **Manifest — no action needed.** There is no manifest file to hand-edit in this repo.
   `.raw-manifest.json` is generated per *installed* target by `bin/cli.mjs` at `raw init` /
   `raw update` time, and its `version` field is read live from `package.json` (`VERSION` const in
   `bin/cli.mjs`). Bumping `package.json` in step 3 is sufficient — do not create or edit a
   `.raw-manifest.json` in this repo.

5. **Report** what you updated (or why you skipped a step) before committing.
