#!/usr/bin/env node
// raw — installer for the agentic issue-board workflow.
// Usage:
//   npx github:rodrigoeduardo/raw init [target-dir] [--force] [--labels]
//   npx github:rodrigoeduardo/raw labels
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "template");
const MARKER = "BEGIN:raw-workflow";

const WORKFLOW_LABELS = [
  ["status:proposed", "BFD4F2", "Awaiting promotion"],
  ["status:ready", "0E8A16", "Claimable by a builder"],
  ["status:in-progress", "FBCA04", "Claimed by a builder"],
  ["status:in-review", "5319E7", "PR open, awaiting review/merge"],
  ["status:blocked", "B60205", "Stuck — see issue comment"],
  ["ai-review:requested", "C2E0C6", "AI review requested"],
  ["ai-review:approved", "0E8A16", "AI verdict: criteria met"],
  ["ai-review:changes-requested", "D93F0B", "AI verdict: issues found"],
  ["ai-review:final", "1D76DB", "Human pre-authorizes AI approval (human-only)"],
  ["human-action-needed", "B60205", "Human steps pending — not claimable"],
  ["auto:hold", "EEEEEE", "autopilot: skip this issue/PR"],
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function installClaudeMd(target, content) {
  const dest = join(target, "CLAUDE.md");
  if (!existsSync(dest)) {
    writeFileSync(dest, content);
    return "created CLAUDE.md";
  }
  if (readFileSync(dest, "utf8").includes(MARKER)) return "skip CLAUDE.md (raw section already present)";
  appendFileSync(dest, "\n" + content);
  return "appended raw section to CLAUDE.md";
}

function init(target, { force }) {
  if (!existsSync(target)) {
    console.error(`Target directory does not exist: ${target}`);
    process.exit(1);
  }
  const results = { copied: [], skipped: [] };
  for (const src of walk(TEMPLATE_DIR)) {
    const rel = relative(TEMPLATE_DIR, src);
    if (rel === "CLAUDE.md.example") continue; // handled separately
    const dest = join(target, rel);
    if (existsSync(dest) && !force) {
      results.skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
    results.copied.push(rel);
  }
  const claudeMd = installClaudeMd(target, readFileSync(join(TEMPLATE_DIR, "CLAUDE.md.example"), "utf8"));

  for (const f of results.copied) console.log(`  + ${f}`);
  for (const f of results.skipped) console.log(`  = ${f} (exists, skipped${force ? "" : " — use --force to overwrite"})`);
  console.log(`  * ${claudeMd}`);
  console.log(`
Installed. Next steps:
  1. Run /configure in Claude Code — gates, commands, area labels (writes raw.config.yml).
  2. Create workflow labels: npx github:rodrigoeduardo/raw labels   (or let /configure do it)
  3. Wire CI for your stack (see examples/ in the raw repo) — the merge gate needs green checks.
  4. Install the bound sub-skills (default: obra/superpowers) or rebind them in raw.config.yml.
  5. Fill docs/specs/, then /plan-board → /next-task or /autopilot.
`);
}

function createLabels() {
  for (const [name, color, description] of WORKFLOW_LABELS) {
    try {
      execSync(
        `gh label create ${JSON.stringify(name)} --color ${color} --description ${JSON.stringify(description)}`,
        { stdio: "pipe" },
      );
      console.log(`  + label ${name}`);
    } catch (err) {
      const msg = String(err.stderr || err.message);
      if (msg.includes("already exists")) console.log(`  = label ${name} (exists)`);
      else {
        console.error(`  ! label ${name}: ${msg.trim()}`);
        process.exitCode = 1;
      }
    }
  }
}

const args = process.argv.slice(2);
const cmd = args[0];
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.slice(1).filter((a) => !a.startsWith("--"));

switch (cmd) {
  case "init": {
    const target = resolve(positional[0] ?? ".");
    console.log(`Installing raw workflow into ${target}`);
    init(target, { force: flags.has("--force") });
    if (flags.has("--labels")) createLabels();
    break;
  }
  case "labels":
    createLabels();
    break;
  default:
    console.log(`raw — installable agentic issue-board workflow

Commands:
  init [dir] [--force] [--labels]   Install workflow files into a repo (default: cwd)
  labels                            Create the workflow's GitHub labels via gh
`);
    if (cmd !== undefined && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
}
