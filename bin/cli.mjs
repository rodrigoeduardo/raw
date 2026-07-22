#!/usr/bin/env node
// raw — installer for the agentic issue-board workflow.
// Usage:
//   npx github:rodrigoeduardo/raw init [target-dir] [--force] [--labels]
//   npx github:rodrigoeduardo/raw update [target-dir] [--force] [--dry-run]
//   npx github:rodrigoeduardo/raw manifest bootstrap [target-dir]
//   npx github:rodrigoeduardo/raw labels
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = join(PKG_DIR, "template");
const VERSION = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")).version;
const MARKER_BEGIN = "<!-- BEGIN:raw-workflow -->";
const MARKER_END = "<!-- END:raw-workflow -->";
const MANIFEST_FILE = ".raw-manifest.json";

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

function templateFiles() {
  return walk(TEMPLATE_DIR)
    .map((abs) => relative(TEMPLATE_DIR, abs))
    .filter((rel) => rel !== "CLAUDE.md.example");
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadManifest(target) {
  const path = join(target, MANIFEST_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveManifest(target, manifest) {
  writeFileSync(join(target, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
}

function claudeMdBlock(content) {
  // content is the raw CLAUDE.md.example file, already wrapped in BEGIN/END markers.
  return content.trim() + "\n";
}

function upsertClaudeMdBlock(target, block) {
  const dest = join(target, "CLAUDE.md");
  if (!existsSync(dest)) {
    writeFileSync(dest, block);
    return "created CLAUDE.md";
  }
  const current = readFileSync(dest, "utf8");
  const beginIdx = current.indexOf(MARKER_BEGIN);
  const endIdx = current.indexOf(MARKER_END);
  if (beginIdx === -1 || endIdx === -1) {
    appendFileSync(dest, "\n" + block);
    return "appended raw section to CLAUDE.md";
  }
  const before = current.slice(0, beginIdx);
  const after = current.slice(endIdx + MARKER_END.length);
  if (current.slice(beginIdx, endIdx + MARKER_END.length).trim() === block.trim()) {
    return "CLAUDE.md raw section already current";
  }
  writeFileSync(dest, before + block.trim() + after);
  return "updated raw section in CLAUDE.md";
}

function init(target, { force, labels }) {
  if (!existsSync(target)) {
    console.error(`Target directory does not exist: ${target}`);
    process.exit(1);
  }
  const manifest = loadManifest(target) ?? { version: VERSION, files: {} };
  const copied = [];
  const skipped = [];
  for (const rel of templateFiles()) {
    const src = join(TEMPLATE_DIR, rel);
    const dest = join(target, rel);
    if (existsSync(dest) && !force) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
    manifest.files[rel] = hashFile(src);
    copied.push(rel);
  }
  manifest.version = VERSION;
  saveManifest(target, manifest);

  const claudeMdResult = upsertClaudeMdBlock(
    target,
    claudeMdBlock(readFileSync(join(TEMPLATE_DIR, "CLAUDE.md.example"), "utf8")),
  );

  for (const f of copied) console.log(`  + ${f}`);
  for (const f of skipped) console.log(`  = ${f} (exists, skipped${force ? "" : " — use --force to overwrite"})`);
  console.log(`  * ${claudeMdResult}`);
  console.log(`  * wrote ${MANIFEST_FILE} (version ${VERSION})`);
  console.log(`
Installed. Next steps:
  1. Run /configure in Claude Code — gates, commands, area labels (writes raw.config.yml).
  2. Create workflow labels: npx github:rodrigoeduardo/raw labels   (or let /configure do it)
  3. Wire CI for your stack (see examples/ in the raw repo) — the merge gate needs green checks.
  4. Install the bound sub-skills (default: obra/superpowers) or rebind them in raw.config.yml.
  5. Fill docs/specs/, then /plan-board → /next-task or /autopilot.

Later, check for and apply updates with: npx github:rodrigoeduardo/raw update
`);
  if (labels) createLabels();
}

function update(target, { force, dryRun }) {
  if (!existsSync(target)) {
    console.error(`Target directory does not exist: ${target}`);
    process.exit(1);
  }
  const manifest = loadManifest(target);
  if (!manifest) {
    console.error(
      `No ${MANIFEST_FILE} found in ${target}.\n` +
        `This install predates update tracking, or was never installed via 'raw init'.\n` +
        `Run 'npx github:rodrigoeduardo/raw manifest bootstrap' first (records current files as the baseline, assuming they're unmodified), then re-run update.`,
    );
    process.exit(1);
  }
  if (manifest.version === VERSION) {
    console.log(`Already at raw ${VERSION}. Nothing to update.`);
    return;
  }
  console.log(`Updating raw ${manifest.version} -> ${VERSION}${dryRun ? " (dry run)" : ""}`);

  const nextFiles = { ...manifest.files };
  for (const rel of templateFiles()) {
    const src = join(TEMPLATE_DIR, rel);
    const dest = join(target, rel);
    const srcHash = hashFile(src);
    const baselineHash = manifest.files[rel];
    const destExists = existsSync(dest);

    if (!destExists) {
      if (baselineHash) {
        console.log(`  ! ${rel} (previously removed locally, skipped — delete its entry from ${MANIFEST_FILE} to reinstall)`);
        continue;
      }
      console.log(`  + ${rel} (new in this version)`);
      if (!dryRun) {
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest);
      }
      nextFiles[rel] = srcHash;
      continue;
    }

    const destHash = hashFile(dest);
    if (destHash === srcHash) {
      nextFiles[rel] = srcHash;
      continue; // already current
    }
    if (destHash === baselineHash) {
      console.log(`  ~ ${rel} (updated)`);
      if (!dryRun) cpSync(src, dest);
      nextFiles[rel] = srcHash;
      continue;
    }
    // locally modified since install
    if (force) {
      console.log(`  ! ${rel} (locally modified, overwritten with --force — your edits are lost)`);
      if (!dryRun) cpSync(src, dest);
      nextFiles[rel] = srcHash;
    } else {
      console.log(`  ! ${rel} (locally modified, skipped — pass --force to overwrite and lose local edits)`);
    }
  }

  const claudeMdResult = dryRun
    ? "CLAUDE.md raw section (dry run, not applied)"
    : upsertClaudeMdBlock(target, claudeMdBlock(readFileSync(join(TEMPLATE_DIR, "CLAUDE.md.example"), "utf8")));
  console.log(`  * ${claudeMdResult}`);

  if (!dryRun) {
    saveManifest(target, { version: VERSION, files: nextFiles });
    console.log(`  * ${MANIFEST_FILE} updated to version ${VERSION}`);
  } else {
    console.log(`  (dry run — no files written)`);
  }
}

function manifestBootstrap(target) {
  if (!existsSync(target)) {
    console.error(`Target directory does not exist: ${target}`);
    process.exit(1);
  }
  const files = {};
  let tracked = 0;
  for (const rel of templateFiles()) {
    const dest = join(target, rel);
    if (!existsSync(dest)) continue;
    files[rel] = hashFile(dest);
    tracked++;
  }
  saveManifest(target, { version: VERSION, files });
  console.log(
    `Wrote ${MANIFEST_FILE}: ${tracked} file(s) recorded at their current content, baselined as raw ${VERSION}.\n` +
      `Files not present were left untracked (won't be recreated by 'update' unless they reappear in a future raw version).\n` +
      `Any future 'raw update' treats today's content as the "unmodified" baseline — if you've already hand-edited these files, that drift won't be flagged.`,
  );
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
    init(target, { force: flags.has("--force"), labels: flags.has("--labels") });
    break;
  }
  case "update": {
    const target = resolve(positional[0] ?? ".");
    update(target, { force: flags.has("--force"), dryRun: flags.has("--dry-run") });
    break;
  }
  case "manifest": {
    if (positional[0] !== "bootstrap") {
      console.error("Usage: raw manifest bootstrap [dir]");
      process.exit(1);
    }
    manifestBootstrap(resolve(positional[1] ?? "."));
    break;
  }
  case "labels":
    createLabels();
    break;
  default:
    console.log(`raw — installable agentic issue-board workflow (v${VERSION})

Commands:
  init [dir] [--force] [--labels]       Install workflow files into a repo (default: cwd)
  update [dir] [--force] [--dry-run]    Apply upstream changes; skips files you've edited locally
  manifest bootstrap [dir]              Record current files as the update baseline (pre-existing installs)
  labels                                Create the workflow's GitHub labels via gh
`);
    if (cmd !== undefined && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
}
