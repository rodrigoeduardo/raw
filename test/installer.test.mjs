import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "cli.mjs");
const FIXTURES = join(ROOT, "test", "fixtures");

function scratchRepo() {
  const target = mkdtempSync(join(tmpdir(), "raw-init-"));
  execFileSync("git", ["init", "-q", target]);
  return target;
}

function runCli(...args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

test("raw init installs canonical Claude skills and Codex compatibility", () => {
  const target = scratchRepo();

  runCli("init", target);

  assert.equal(lstatSync(join(target, ".claude", "skills", "build-issue", "SKILL.md")).isFile(), true);
  assert.equal(lstatSync(join(target, ".claude", "scripts", "run-codex.mjs")).isFile(), true);
  assert.equal(lstatSync(join(target, ".agents", "skills")).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(target, ".agents", "skills")), "../.claude/skills");
  assert.equal(
    readFileSync(join(target, ".agents", "skills", "build-issue", "SKILL.md"), "utf8"),
    readFileSync(join(target, ".claude", "skills", "build-issue", "SKILL.md"), "utf8"),
  );
});

test("raw init is idempotent when Codex compatibility already exists", () => {
  const target = scratchRepo();

  runCli("init", target);
  const output = runCli("init", target);

  assert.match(output, /\.agents\/skills compatibility already current/);
  assert.equal(lstatSync(join(target, ".agents", "skills")).isSymbolicLink(), true);
});

test("raw init preserves a user-owned .agents/skills directory", () => {
  const target = scratchRepo();
  const skills = join(target, ".agents", "skills");
  mkdirSync(skills, { recursive: true });
  writeFileSync(join(skills, "mine.txt"), "keep me\n");

  const output = runCli("init", target);

  assert.match(output, /\.agents\/skills \(conflict: existing non-link path preserved\)/);
  assert.equal(lstatSync(skills).isDirectory(), true);
  assert.equal(readFileSync(join(skills, "mine.txt"), "utf8"), "keep me\n");
});

test("raw init reports a user-owned .agents file without overwriting it", () => {
  const target = scratchRepo();
  const agents = join(target, ".agents");
  writeFileSync(agents, "keep me\n");

  const output = runCli("init", target);

  assert.match(output, /\.agents\/skills \(conflict: \.agents is not a directory; preserved\)/);
  assert.equal(readFileSync(agents, "utf8"), "keep me\n");
});

test("raw update repairs missing Codex compatibility without overwriting conflicts", () => {
  const target = scratchRepo();
  runCli("init", target);
  const manifestPath = join(target, ".raw-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = "0.0.0";
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const skills = join(target, ".agents", "skills");
  unlinkSync(skills);
  runCli("update", target);

  assert.equal(lstatSync(skills).isSymbolicLink(), true);
  assert.equal(readlinkSync(skills), "../.claude/skills");
});

test("raw update migrates an actual 0.5.0 manifest and installs refactor files", () => {
  const target = scratchRepo();
  cpSync(join(FIXTURES, "raw-0.5.0"), target, { recursive: true });

  const output = runCli("update", target);
  const manifest = JSON.parse(readFileSync(join(target, ".raw-manifest.json"), "utf8"));

  assert.match(output, /Updating raw 0\.5\.0 -> 0\.6\.0/);
  assert.equal(lstatSync(join(target, ".claude", "skills", "build-issue", "SKILL.md")).isFile(), true);
  assert.equal(lstatSync(join(target, ".claude", "scripts", "run-codex.mjs")).isFile(), true);
  assert.equal(manifest.version, "0.6.0");
});

test("raw update applies Codex compatibility even when files are already current", () => {
  const target = scratchRepo();
  runCli("init", target);
  const skills = join(target, ".agents", "skills");
  unlinkSync(skills);

  const output = runCli("update", target);

  assert.match(output, /created \.agents\/skills/);
  assert.equal(readlinkSync(skills), "../.claude/skills");
});

test("raw update preserves a user-owned Codex skills path", () => {
  const target = scratchRepo();
  runCli("init", target);
  const skills = join(target, ".agents", "skills");
  unlinkSync(skills);
  mkdirSync(skills);
  writeFileSync(join(skills, "mine.txt"), "keep me\n");

  const output = runCli("update", target);

  assert.match(output, /\.agents\/skills \(conflict: existing non-link path preserved\)/);
  assert.equal(readFileSync(join(skills, "mine.txt"), "utf8"), "keep me\n");
});

test("the RAW source repository exposes canonical skills to Codex without copies", () => {
  const skills = join(ROOT, ".agents", "skills");

  assert.equal(lstatSync(skills).isSymbolicLink(), true);
  assert.equal(readlinkSync(skills), "../template/.claude/skills");
});
