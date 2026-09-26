// Tests for the redaction hook and the human-input-secret command.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../plugins/human-input/hooks/secrets.mjs", import.meta.url));
const BIN = fileURLToPath(new URL("../plugins/human-input/bin", import.meta.url));
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), "human-input-store-"));
process.env.HUMAN_INPUT_STORE = STORE;
const store = await import("../plugins/human-input/server/store.mjs");

const PROJECT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "human-input-proj-")));
fs.mkdirSync(path.join(PROJECT, "sub"));
const SECRET = `sk_live_it's a "tricky" $value\\with \`stuff\``;
store.set("API_KEY", SECRET, {}, PROJECT);
store.set("REGION", "eu-west-1", { secret: false }, PROJECT);

const env = { ...process.env, HUMAN_INPUT_STORE: STORE, PATH: `${BIN}:${process.env.PATH}` };
delete env.CLAUDE_PROJECT_DIR;

function runHook(input) {
  const r = spawnSync(process.execPath, [HOOK, "post"], {
    input: JSON.stringify({ cwd: PROJECT, ...input }),
    env: { ...env, CLAUDE_PROJECT_DIR: PROJECT },
  });
  assert.equal(r.status, 0, r.stderr.toString());
  const out = r.stdout.toString();
  return out ? JSON.parse(out) : undefined;
}

const bash = (cmd, cwd = PROJECT) => execFileSync("bash", ["-c", cmd], { cwd, env }).toString();

test("human-input-secret expands to the exact value inside other commands", () => {
  assert.equal(bash('printf %s "$(human-input-secret API_KEY)"'), SECRET);
  assert.equal(bash('printf %s "key=$(human-input-secret REGION);"'), "key=eu-west-1;");
  // Works from a subdirectory without CLAUDE_PROJECT_DIR.
  assert.equal(bash('printf %s "$(human-input-secret REGION)"', path.join(PROJECT, "sub")), "eu-west-1");
});

test("human-input-secret fails clearly for unknown names and bad usage", () => {
  const r = spawnSync("bash", ["-c", "human-input-secret MISSING"], { cwd: PROJECT, env });
  assert.equal(r.status, 1);
  assert.match(r.stderr.toString(), /nothing stored as MISSING\. Stored: API_KEY, REGION/);
  assert.equal(spawnSync("bash", ["-c", "human-input-secret"], { cwd: PROJECT, env }).status, 2);
});

test("post hook redacts secrets from Bash, Read and Grep output (not non-secret values)", () => {
  const b = runHook({ tool_name: "Bash", tool_response: { stdout: `got ${SECRET} in eu-west-1`, stderr: "" } });
  assert.equal(b.hookSpecificOutput.updatedToolOutput.stdout, "got [redacted:API_KEY] in eu-west-1");

  const r = runHook({ tool_name: "Read", tool_response: { type: "text", file: { content: `API_KEY=${SECRET}\n`, numLines: 2 } } });
  assert.deepEqual(r.hookSpecificOutput.updatedToolOutput, { type: "text", file: { content: "API_KEY=[redacted:API_KEY]\n", numLines: 2 } });

  assert.equal(runHook({ tool_name: "Bash", tool_response: { stdout: "nothing here" } }), undefined);
});

test("hooks never rewrite tool input", () => {
  const hooks = JSON.parse(fs.readFileSync(new URL("../plugins/human-input/hooks/hooks.json", import.meta.url), "utf8")).hooks;
  assert.deepEqual(Object.keys(hooks), ["PostToolUse"]);
  assert.ok(!fs.readFileSync(HOOK, "utf8").includes("updatedInput"));
});
