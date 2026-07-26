---
name: plan-board
description: Use when the user wants to populate or refresh the board from specs — decomposing specs into GitHub issues, planning tasks, proposing follow-ups from PR notes, or reconciling the board after spec changes.
---

# Plan Board (planner)

Decompose the specs (`raw.config.yml` → `specs_dir`, default `docs/specs/`) into small, testable board issues. Issues are **proposed only** — promotion to `status:ready` follows the promote gate (`gates.promote`, default human).

**REQUIRED READING:** `docs/workflow/board-protocol.md` (labels, lifecycle, gates). Follow it exactly.

**Adapters.** The `gh` commands below are the `tracker.provider: github` spelling (the default). Under any other tracker, read `docs/workflow/adapters/tracker-<provider>.md` for the equivalent create/list/label operations — the decomposition rules and the draft-then-approve flow are the same. Under `linear`, express dependencies as native `blockedBy` relations instead of `Depends on #N` lines.

## Procedure

1. **Read inputs**
   - Entire specs tree (`specs_dir`).
   - Open issues: `gh issue list --state open --limit 200 --json number,title,labels,body` — never propose duplicates.
   - Notes sections of recently merged PRs (`gh pr list --state merged --limit 20 --json number,body`) — follow-ups become proposals.

2. **Decompose** per area (`labels.areas` in `raw.config.yml`). Each task must be:
   - completable in one builder session;
   - objectively verifiable (checkbox acceptance criteria, input → expected outcome);
   - explicit about dependencies and human-only actions.

   ### Decomposition rules

   The issue **is** the builder's prompt. A ticket that fails twice is a spec defect (see
   board-protocol.md), so these rules are what keep tickets from being defective:

   - **No test-only tickets.** Tests ship with the behavior they cover, in the same ticket. A
     ticket whose whole deliverable is "add tests for X" means X's ticket was underspecified.
   - **Migration + schema usage in one ticket.** A migration that lands without the code reading
     it is an un-reviewable, un-verifiable half-step.
   - **No "foundation" tickets.** Never propose a ticket that only adds functions/types/modules
     nobody calls yet. Every ticket must change observable behavior or be provably exercised.
   - **One ticket = one reviewable PR**, targeting ≲400 changed lines. Bigger → split by
     behavior (not by layer), and record the split as a dependency chain.
   - **Dependencies are explicit or absent.** Only `Depends on #N` lines count; never infer a
     dependency from similar titles or shared areas. Getting this wrong either serializes
     independent work or hands a builder a blocker that isn't there.
   - **Risky features are born OFF.** A user-visible or risky ticket fills "Rollout &
     observability" with a flag/kill-switch defaulting off plus the events that prove it works.
     The kill-switch is what lets every PR merge without changing behavior until a human flips it.
     Surface the flip in the draft; never flip it yourself.
   - **Fill the whole template.** Expected behavior, Test scenarios and Technical notes are not
     optional decoration — they are the difference between a builder implementing the task and a
     builder guessing at it.

3. **Draft first — never create issues directly.** Write `docs/workflow/drafts/plan-YYYY-MM-DD.md`:

   | # | Title | Area | Wave | Depends on | Acceptance criteria (summary) | Human actions |
   |---|---|---|---|---|---|---|

   **Wave** = `max(wave of each blocker) + 1`; a ticket with no open blockers is wave 1. It is
   ordering/reporting only (dispatchers still schedule off the claimable frontier — see
   `autopilot`), but it makes the critical path and the fan-in tickets visible while the human can
   still cheaply change them.

   Flag in the draft: existing open issues that contradict current specs (human decides).

4. **Present the draft in-session.** User edits/cuts/approves the batch. STOP here without explicit approval.

5. **Create issues** only after approval, in dependency order (so `#N` references exist):

   ```bash
   gh issue create \
     --title "[area] Imperative description" \
     --label "status:proposed" --label "area:<x>" \
     --body-file <(...)   # body follows .github/ISSUE_TEMPLATE/task.md sections
   ```

   Body must contain every template section: Goal, **User-visible** (`yes`/`no` — `yes` activates the evidence gate, see review-policy.md), Pre-requisites (`Depends on #N` one per line), Requirements, Expected behavior, Test scenarios, Technical notes, Rollout & observability, Human actions, Out of scope, References.

   Add `--label "human-action-needed"` whenever the issue's "Human actions" section is anything other than "None" (see board-protocol.md). The human removes the label once those steps are done.

6. Commit the draft file.

## Re-runs

Later runs propose **deltas only**: new/changed spec sections, PR-note follow-ups. Never recreate or edit issues that are `ready`/`in-progress`/`in-review` — flag conflicts in the draft instead.

### Spec-defect rewrites

An issue sent back to `status:proposed` with a "needs rewrite" comment (two-strikes rule,
board-protocol.md) is **your** input, not a builder's. Treat it as a first-class delta:

1. Read the comment plus both failed attempts' timelines (PR comments, reviewer findings, blocked
   reasons) — the ambiguity is usually visible there, not in the specs.
2. Rewrite the ticket body: tighten Requirements to objectively checkable criteria, fill Expected
   behavior / Test scenarios / Technical notes with what the attempts had to guess, and split it if
   the failures show it was two tasks.
3. Put the rewrite in the draft like any other proposal (the human approves), then edit the issue
   in place — keeping the number preserves the timeline that records why it was rewritten.

## Red flags — stop

- Creating issues without an approved draft
- Issue without verifiable acceptance criteria
- Labeling a status other than `status:proposed` (area + `human-action-needed` are fine)
- Omitting `human-action-needed` on an issue with a non-empty "Human actions" section
- Duplicating an existing open issue
- Proposing a test-only, migration-only, or unused-"foundation" ticket
- Inferring a dependency the ticket bodies don't state as `Depends on #N`
- Relaunching a twice-failed issue unchanged instead of rewriting it
