# Adapter — evidence driver: playwright (default)

Active when `raw.config.yml` → `evidence.ui_screenshot` is not `off` **and** `evidence.driver` is
`playwright` (the default). This is the whole capture procedure for the evidence gate
(`../review-policy.md`) — the builder skill and the executor agent point here rather than restating
it.

`evidence.driver: manual` skips this doc entirely: the worker produces the artifact however it can.
That's the escape hatch for stacks Playwright can't drive (native apps, hardware, terminal UIs).

**The gate blocks.** Every failure below is reported as `BLOCKED` with its reason — never a warning,
never a silent skip. A gate that degrades under pressure catches nothing, and "the feature is
invisible on screen while its tests pass" is exactly the failure it exists for.

## 1. Start the app

Run the configured `commands.dev` as a **background** command from the worktree root. Unset →
`BLOCKED: evidence gate active but commands.dev is unset`. Do not guess a start command.

## 2. Learn the URL

Read the dev server's own output and take the first `http(s)://…` it prints — that is the source of
truth for host and port. There is no `evidence.url` config key on purpose: a hardcoded default is
wrong on every non-default port, and worktrees running in parallel get different ones.

Give it **60 seconds**. Nothing printed by then → `BLOCKED: dev server never printed a URL` (include
the last lines of its output in the issue comment — that's usually a missing env var, not a code
problem).

## 3. Drive the flow

The issue's **Expected behavior** and **Test scenarios** say what to drive. Screenshot the state that
demonstrates the acceptance criteria — the filled form after validation fires, not the empty page.
Viewport **1280×800** unless the issue's behavior is explicitly about another size.

**Preferred — Playwright MCP**, when the session has those tools. Nothing is installed into the
target repo:

```
browser_navigate <url>            → the route under test
browser_click / browser_type …    → the interactions the scenarios describe
browser_take_screenshot           → save to the path in §4
```

**Fallback — Playwright CLI**, when there's no MCP server. Check `npx playwright --version` first;
if that fails too → `BLOCKED: no playwright driver available (no MCP server, npx playwright not
installed)`.

```bash
# static route, no interaction needed:
npx playwright screenshot --viewport-size=1280,800 "<url>/<route>" docs/evidence/<issue#>-<slug>.png

# multi-step flow: write a scratch spec, run it, keep the PNG (not the spec)
npx playwright test <scratch-spec> --reporter=line
```

The scratch spec is a throwaway in your scratchpad — it is **not** part of the diff. Tests that
belong to the feature are written under TDD like any other test; this is a capture script.

If the flow can't be driven (element never appears, auth wall with no test credentials, unhandled
crash) → `BLOCKED` with the specific step that failed. Don't ship a screenshot of the wrong state.

## 4. Persist the artifact

GitHub has no attachment API, and `gh` can't upload an image — markdown image syntax needs an
already-hosted URL. So the artifact is **committed to the task branch**:

```bash
docs/evidence/<issue#>-<slug>.png     # e.g. docs/evidence/42-signup-form.png
```

Commit it on its own (evidence is not a code change, and the atomic-commit rule in
`../git-conventions.md` applies here too):

```bash
git add docs/evidence/<issue#>-<slug>.png
git commit -m "chore(evidence): screenshot for #<issue#>"
```

Then link it from the PR's **Requirements coverage** section, against the criterion it proves:

```markdown
- [x] Signup form shows inline validation on a bad email
      ![evidence](docs/evidence/42-signup-form.png)
```

The blob renders in the PR, so the reviewer opens it without leaving the diff. `docs/evidence/*` is
expected output on a gated issue — `review-pr` exempts it from the scope check.

## 5. Stop the app

Kill the background `commands.dev` process. A dev server left running holds its port and the next
parallel worker's capture fails on a URL that isn't its own.

## Blocking reasons (exact strings)

| Situation | Report |
|---|---|
| `commands.dev` unset | `BLOCKED: evidence gate active but commands.dev is unset` |
| No URL within 60s | `BLOCKED: dev server never printed a URL` |
| No MCP server and no `npx playwright` | `BLOCKED: no playwright driver available` |
| Flow can't be driven | `BLOCKED: could not drive <step> — <what happened>` |

## Repo weight

Each gated issue leaves roughly 100–300 KB in history, permanently. That's the price of an artifact a
human can still open six months later. `docs/evidence/` can be pruned whenever you like — the
artifact's job ends once someone besides the worker has looked at it.
