#!/usr/bin/env node
import { readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const options = {
  cwd: process.cwd(),
  deleteInput: false,
  effort: null,
  inputFile: null,
  model: null,
};

let index = 2;
for (; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--") {
    index += 1;
    break;
  }
  if (arg === "--delete-input") {
    options.deleteInput = true;
    continue;
  }
  if (["--cwd", "--effort", "--input-file", "--model"].includes(arg)) {
    const value = process.argv[index + 1];
    if (!value) throw new Error(`${arg} requires a value`);
    options[
      {
        "--cwd": "cwd",
        "--effort": "effort",
        "--input-file": "inputFile",
        "--model": "model",
      }[arg]
    ] = value;
    index += 1;
    continue;
  }
  throw new Error(`Unknown argument: ${arg}`);
}

const command = process.argv.slice(index);
if (!options.model) throw new Error("--model is required");
if (!options.effort) throw new Error("--effort is required");
if (command.length === 0) throw new Error("a Codex command is required after --");
if (options.deleteInput && !options.inputFile) {
  throw new Error("--delete-input requires --input-file");
}

const prompt = options.inputFile ? readFileSync(options.inputFile) : readFileSync(0);
if (options.deleteInput) unlinkSync(options.inputFile);

const result = spawnSync(
  command[0],
  [
    ...command.slice(1),
    "--model",
    options.model,
    "-c",
    `model_reasoning_effort="${options.effort}"`,
    "-",
  ],
  {
    cwd: options.cwd,
    input: prompt,
    stdio: ["pipe", "inherit", "inherit"],
  },
);

if (result.error) throw result.error;
if (result.signal) {
  console.error(`Codex runner terminated by ${result.signal}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
