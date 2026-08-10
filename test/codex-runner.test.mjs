import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = join(ROOT, "template", ".claude", "scripts", "run-codex.mjs");

function makeFakeCodex(root) {
  const fake = join(root, "fake-codex.mjs");
  writeFileSync(
    fake,
    `import { writeFileSync } from "node:fs";
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
writeFileSync(process.env.RAW_TEST_CAPTURE, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  prompt,
}));
console.log("DONE pr=#42 branch=feat/42-test");
`,
  );
  return fake;
}

function runRunner(args, { capture, input } = {}) {
  return execFileSync(process.execPath, [RUNNER, ...args], {
    encoding: "utf8",
    env: { ...process.env, RAW_TEST_CAPTURE: capture },
    input,
  });
}

test("claude worktree provider can launch Codex in a real isolated worktree over EOF-closed stdin", () => {
  assert.equal(existsSync(RUNNER), true, "the installed workflow must ship an executable Codex runner");

  const root = mkdtempSync(join(tmpdir(), "raw-codex-claude-"));
  const repo = join(root, "repo");
  const worktree = join(root, "worker");
  const capture = join(root, "capture.json");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "raw@example.com"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "RAW tests"]);
  writeFileSync(join(repo, "README.md"), "fixture\n");
  execFileSync("git", ["-C", repo, "add", "README.md"]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "fixture"]);
  execFileSync("git", ["-C", repo, "worktree", "add", "-q", "-b", "feat/42-test", worktree]);

  const prompt = "Use $build-issue to build issue 42.\nStop after this issue.\n";
  const output = runRunner(
    [
      "--cwd",
      worktree,
      "--model",
      "gpt-test",
      "--effort",
      "medium",
      "--",
      process.execPath,
      makeFakeCodex(root),
    ],
    { capture, input: prompt },
  );
  const result = JSON.parse(readFileSync(capture, "utf8"));

  assert.equal(result.cwd, realpathSync(worktree));
  assert.equal(result.prompt, prompt);
  assert.deepEqual(result.args, [
    "--model",
    "gpt-test",
    "-c",
    'model_reasoning_effort="medium"',
    "-",
  ]);
  assert.match(output, /^DONE pr=#42 branch=feat\/42-test$/m);
});

test("orca worktree provider consumes its temporary prompt before launching Codex", () => {
  assert.equal(existsSync(RUNNER), true, "the installed workflow must ship an executable Codex runner");

  const root = mkdtempSync(join(tmpdir(), "raw-codex-orca-"));
  const worktree = join(root, "worker");
  const promptFile = join(root, "prompt.txt");
  const capture = join(root, "capture.json");
  mkdirSync(worktree);
  writeFileSync(promptFile, "Use $build-issue to build issue 77.\n");

  runRunner(
    [
      "--cwd",
      worktree,
      "--input-file",
      promptFile,
      "--delete-input",
      "--model",
      "gpt-test",
      "--effort",
      "low",
      "--",
      process.execPath,
      makeFakeCodex(root),
    ],
    { capture },
  );
  const result = JSON.parse(readFileSync(capture, "utf8"));

  assert.equal(result.cwd, realpathSync(worktree));
  assert.equal(result.prompt, "Use $build-issue to build issue 77.\n");
  assert.equal(existsSync(promptFile), false);
});
