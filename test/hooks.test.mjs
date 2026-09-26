// Tests for the PreToolUse / PostToolUse hooks: placeholders are swapped for
// real values at run time, and stored secrets are redacted from tool output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../plugins/human-input/hooks/secrets.mjs", import.meta.url));
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), "human-input-store-"));
process.env.HUMAN_INPUT_STORE = STORE;
const store = await import("../plugins/human-input/server/store.mjs");
const { substituteBash } = await import("../plugins/human-input/hooks/secrets.mjs");

const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), "human-input-proj-"));
const SECRET = `sk_live_it's a "tricky" $value\\with \`stuff\``;
store.set("API_KEY", SECRET, {}, PROJECT);
store.set("REGION", "eu-west-1", { secret: false }, PROJECT);

function runHook(mode, input) {
  const r = spawnSync(process.execPath, [HOOK, mode], {
    input: JSON.stringify({ cwd: PROJECT, ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT, HUMAN_INPUT_STORE: STORE },
  });
  assert.equal(r.status, 0, r.stderr.toString());
  const out = r.stdout.toString();
  return out ? JSON.parse(out) : undefined;
}

const bash = (cmd) => execFileSync("bash", ["-c", cmd]).toString();
const sub = (cmd) => substituteBash(cmd, (n) => store.valuePath(n, PROJECT));

test("bash: placeholder works unquoted, in double quotes, and in heredocs", () => {
  assert.equal(bash(sub("printf %s {{secret:API_KEY}}").command), SECRET);
  assert.equal(bash(sub('printf %s "key={{secret:API_KEY}};"').command), `key=${SECRET};`);
  assert.equal(bash(sub("X={{secret:API_KEY}}; printf %s \"$X\"").command), SECRET);
  assert.equal(bash(sub("cat <<EOF\ntoken: {{secret:API_KEY}}\nEOF").command), `token: ${SECRET}\n`);
  assert.equal(bash(sub("cat <<-EOF\n\ta={{secret:REGION}}\n\tEOF\necho after {{secret:REGION}}").command), "a=eu-west-1\nafter eu-west-1\n");
  // Single-quoted text around it is fine as long as the placeholder is outside.
  assert.equal(bash(sub("printf '%s' 'k='{{secret:REGION}}").command), "k=eu-west-1");
});

test("bash: the rewritten command never contains the value", () => {
  const { command } = sub("curl -H \"Authorization: Bearer {{secret:API_KEY}}\" https://example.com");
  assert.ok(!command.includes(SECRET));
  assert.match(command, /\$\(cat '.*\/values\/API_KEY'\)/);
});

test("bash: placeholder inside single quotes or a quoted heredoc is an error", () => {
  assert.match(sub("echo '{{secret:API_KEY}}'").error, /single quotes/);
  assert.match(sub("cat <<'EOF'\n{{secret:API_KEY}}\nEOF").error, /single quotes/);
});

test("pre hook rewrites Bash through $(cat …)", () => {
  const out = runHook("pre", { tool_name: "Bash", tool_input: { command: "gh secret set API_KEY --body {{secret:API_KEY}}", description: "d" } });
  const cmd = out.hookSpecificOutput.updatedInput.command;
  assert.equal(out.hookSpecificOutput.updatedInput.description, "d");
  assert.ok(!JSON.stringify(out).includes(SECRET), "value must not appear in hook output");
  assert.equal(bash(cmd.replace("gh secret set API_KEY --body", "printf %s")), SECRET);
});

test("pre hook puts literal values into MCP tool arguments", () => {
  const out = runHook("pre", {
    tool_name: "mcp__dokploy__application_saveEnvironment",
    tool_input: { applicationId: "app1", env: "API_KEY={{secret:API_KEY}}\nREGION={{secret:REGION}}", nested: [{ v: "{{secret:API_KEY}}" }] },
  });
  assert.deepEqual(out.hookSpecificOutput.updatedInput, {
    applicationId: "app1",
    env: `API_KEY=${SECRET}\nREGION=eu-west-1`,
    nested: [{ v: SECRET }],
  });
});

test("pre hook denies unknown placeholders and ignores calls without any", () => {
  const out = runHook("pre", { tool_name: "Bash", tool_input: { command: "echo {{secret:MISSING}}" } });
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /No stored value for MISSING.*Stored: API_KEY, REGION/);
  assert.equal(runHook("pre", { tool_name: "Bash", tool_input: { command: "ls" } }), undefined);
  assert.equal(
    runHook("pre", { tool_name: "mcp__plugin_human-input_human-input__request_input", tool_input: { title: "{{secret:MISSING}}" } }),
    undefined,
  );
});

test("post hook redacts secrets from Bash, Read and MCP output (but not non-secret values)", () => {
  const b = runHook("post", { tool_name: "Bash", tool_response: { stdout: `got ${SECRET} in eu-west-1`, stderr: "" } });
  assert.equal(b.hookSpecificOutput.updatedToolOutput.stdout, "got {{secret:API_KEY}} in eu-west-1");

  const r = runHook("post", { tool_name: "Read", tool_response: { type: "text", file: { content: `API_KEY=${SECRET}\n`, numLines: 2 } } });
  assert.deepEqual(r.hookSpecificOutput.updatedToolOutput, { type: "text", file: { content: "API_KEY={{secret:API_KEY}}\n", numLines: 2 } });

  const m = runHook("post", { tool_name: "mcp__x__echo", tool_response: [{ type: "text", text: `server got: ${SECRET}` }] });
  assert.deepEqual(m.hookSpecificOutput.updatedMCPToolOutput, [{ type: "text", text: "server got: {{secret:API_KEY}}" }]);

  assert.equal(runHook("post", { tool_name: "Bash", tool_response: { stdout: "nothing here" } }), undefined);
});
