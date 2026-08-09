import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("BUILD execution has one canonical issue implementation path", () => {
  const executor = read("template/.claude/agents/auto-executor.md");
  const nextTask = read("template/.claude/skills/next-task/SKILL.md");
  const buildIssue = read("template/.claude/skills/build-issue/SKILL.md");

  assert.match(executor, /\/build-issue <(?:issue|n)>/);
  assert.doesNotMatch(executor, /invoke the `next-task` skill/);
  assert.match(nextTask, /delegate its implementation to \/build-issue/i);
  assert.match(buildIssue, /exactly one explicit issue/i);
  assert.doesNotMatch(buildIssue, /gh issue list/);
});

test("the canonical build path preserves configured base and tracker close semantics", () => {
  const createPr = read("template/.claude/skills/create-pr/SKILL.md");
  const gitConventions = read("template/docs/workflow/git-conventions.md");

  assert.match(createPr, /git\.integration_branch/);
  assert.match(createPr, /Closes #N[\s\S]*Fixes <ID>/);
  assert.match(createPr, /caller \(`?build-issue`?\)/i);
  assert.match(gitConventions, /configured integration branch/i);
});

test("autopilot claims work before BUILD dispatch and reviewer stays independent", () => {
  const autopilot = read("template/.claude/skills/autopilot/SKILL.md");
  const reviewer = read("template/.claude/agents/auto-reviewer.md");

  assert.ok(autopilot.indexOf("**Claim.") < autopilot.indexOf("**Build."));
  assert.match(reviewer, /never edit code/i);
  assert.match(reviewer, /Delta re-review/);
});

test("token-efficient defaults use one fix cycle and conditional reconciliation", () => {
  const config = read("template/raw.config.yml");
  const babysitter = read("template/.claude/skills/babysit-pr/SKILL.md");
  const agent = read("template/.claude/agents/auto-babysitter.md");

  assert.match(config, /max_fix_cycles: 1/);
  assert.match(config, /babysitter: \{ runner: claude, model: sonnet, effort: low \}/);
  assert.match(config, /reconciler: \{ runner: claude, model: opus, effort: medium \}/);
  assert.match(babysitter, /no\s+substantive blocking findings[\s\S]*do not dispatch/i);
  assert.match(agent, /model: sonnet[\s\S]*effort: low/);
});

test("Codex runner uses the tested stdin bridge for every supported worktree provider", () => {
  const codex = read("template/docs/workflow/adapters/runner-codex.md");
  const claudeWorktrees = read("template/docs/workflow/adapters/worktrees-claude.md");
  const orcaWorktrees = read("template/docs/workflow/adapters/worktrees-orca.md");

  assert.match(codex, /\.agents\/skills/);
  assert.match(codex, /\.claude\/scripts\/run-codex\.mjs/);
  assert.match(claudeWorktrees, /Codex runner[\s\S]*git worktree add[\s\S]*run-codex\.mjs/);
  assert.match(orcaWorktrees, /Codex runner[\s\S]*run-codex\.mjs[\s\S]*--delete-input/);
  assert.doesNotMatch(codex, /--prompt-file/);
  assert.doesNotMatch(codex, /cannot read this repo's Claude skills/i);
});

test("configure accepts exactly the Playwright CLI prerequisite executors enforce", () => {
  const evidence = read("template/docs/workflow/adapters/evidence-playwright.md");
  const configure = read("template/.claude/skills/configure/SKILL.md");

  assert.match(evidence, /Preferred[^\n]*Playwright CLI/i);
  assert.match(evidence, /npx playwright --version/);
  assert.match(configure, /npx playwright --version/);
  assert.doesNotMatch(configure, /Playwright MCP server/);
  assert.doesNotMatch(evidence, /Preferred[^\n]*Playwright MCP/i);
});

test("a reconciler context miss terminates as human escalation without another invocation", () => {
  const babysit = read("template/docs/workflow/pr-babysit.md");
  const skill = read("template/.claude/skills/babysit-pr/SKILL.md");
  const agent = read("template/.claude/agents/auto-babysitter.md");
  const claude = read("template/docs/workflow/adapters/runner-claude.md");

  assert.match(babysit, /NEEDS_CONTEXT[\s\S]*ESCALATE[\s\S]*do not dispatch the\s+reconciler again/i);
  assert.match(skill, /NEEDS_CONTEXT[\s\S]*escalat/i);
  assert.match(agent, /NEEDS_CONTEXT[\s\S]*ESCALATE[\s\S]*never re-dispatch/i);
  assert.match(claude, /NEEDS_CONTEXT pr=#<p> reason=/);
});
