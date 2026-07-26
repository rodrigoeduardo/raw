---
name: Task
about: A board task for the agentic workflow (see docs/workflow/board-protocol.md)
title: "[area] Imperative short description"
labels: status:proposed
---

## Goal

<!-- One paragraph: what this task delivers and why. Link the relevant spec section. -->

**User-visible:** no

<!-- yes = this task changes something a person can see or interact with (UI, a page, a flow, a
     visible API response). "yes" activates the evidence gate: the PR must carry a screenshot of the
     real running app driving the real flow (see docs/workflow/review-policy.md). -->

## Pre-requisites

<!-- Machine-parseable dependencies, one per line: "Depends on #12". Write "None" if independent. -->
<!-- Also list environment/infra needs (e.g. external service provisioned). -->

None

## Requirements

<!-- Verifiable acceptance criteria. Each checkbox must be objectively checkable (input -> expected outcome). -->

- [ ]

## Expected behavior

<!-- What the system does after this task, in user/API terms: states, edge cases, error paths.
     Requirements say what must be true; this says how it behaves. Include what must NOT change. -->

## Test scenarios

<!-- Concrete scenarios a builder can turn into failing tests first: given -> when -> then.
     One line each. Cover at least one happy path and one failure/edge path. -->

-

## Technical notes

<!-- Implementation pointers so the builder doesn't re-derive them: affected modules/files,
     existing patterns to follow, the interface to extend, known gotchas. Not a design doc. -->

## Rollout & observability

<!-- Feature flag / kill-switch (name + default state) and the events/metrics/logs that show it
     working in production. A risky change should be born OFF by default — that is what lets the PR
     merge without changing behavior. Write "None" for low-risk changes (docs, internal refactors). -->

None

## Human actions

<!-- Steps only a human can do (create account, add secret, approve external service). -->
<!-- Write "None" if fully agent-executable. A task with pending human actions cannot be claimed. -->

None

## Out of scope

<!-- Explicit non-goals, to stop scope creep. -->

## References

<!-- Spec anchors, e.g. docs/specs/business-rules.md#some-rule -->
