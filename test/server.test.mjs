// End-to-end tests: the official MCP SDK client plays Claude Code, and its
// elicitation handler plays the human filling in the form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { quoteEnvValue } from "../plugins/human-input/server/index.mjs";

const SERVER = fileURLToPath(new URL("../plugins/human-input/server/index.mjs", import.meta.url));
const SECRET = "sk_test_51Hq'$weird \"value\"\\ with spaces";

function tmpProject({ git = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "human-input-"));
  if (git) execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

async function connect(dir, { elicitation = true, answer } = {}) {
  const client = new Client(
    { name: "test", version: "0" },
    { capabilities: elicitation ? { elicitation: {} } : {} },
  );
  const seen = [];
  if (elicitation) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      seen.push(req.params);
      return answer(req.params);
    });
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, HUMAN_INPUT_NO_BROWSER: "1" },
    stderr: "pipe",
  });
  await client.connect(transport);
  return { client, seen };
}

const resultText = (r) => r.content.map((c) => c.text).join("\n");

test("lists both tools", async () => {
  const { client } = await connect(tmpProject(), { answer: () => ({ action: "cancel" }) });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["confirm_step", "request_input"]);
  await client.close();
});

test("secret is saved to .env, gitignored, and never returned", async () => {
  const dir = tmpProject();
  const { client, seen } = await connect(dir, {
    answer: () => ({ action: "accept", content: { STRIPE_SECRET_KEY: SECRET, STRIPE_PUBLISHABLE_KEY: "pk_test_abc" } }),
  });
  const res = await client.callTool({
    name: "request_input",
    arguments: {
      title: "Stripe test keys",
      url: "https://dashboard.stripe.com/test/apikeys",
      steps: ["Copy the publishable key", "Reveal and copy the secret key"],
      fields: [
        { key: "STRIPE_PUBLISHABLE_KEY", label: "Publishable key", secret: false },
        { key: "STRIPE_SECRET_KEY", label: "Secret key", description: "starts with sk_test_" },
      ],
    },
  });
  const out = resultText(res);
  assert.ok(!res.isError, out);
  assert.ok(!out.includes(SECRET), "secret leaked into tool result");
  assert.ok(!out.includes("sk_test_51"), "secret prefix leaked into tool result");
  assert.match(out, /STRIPE_PUBLISHABLE_KEY: saved = "pk_test_abc"/);
  assert.match(out, /STRIPE_SECRET_KEY: saved \(\d+ chars, hidden\)/);

  // The form carried the wizard info.
  assert.match(seen[0].message, /https:\/\/dashboard\.stripe\.com\/test\/apikeys/);
  assert.match(seen[0].message, /1\. Copy the publishable key/);
  assert.deepEqual(seen[0].requestedSchema.required, ["STRIPE_PUBLISHABLE_KEY", "STRIPE_SECRET_KEY"]);

  const env = path.join(dir, ".env");
  assert.equal(fs.statSync(env).mode & 0o777, 0o600);
  // Round-trips through a shell exactly.
  const got = execFileSync("bash", ["-c", 'set -a; . ./.env; set +a; printf %s "$STRIPE_SECRET_KEY"'], { cwd: dir }).toString();
  assert.equal(got, SECRET);
  assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /^\/\.env$/m);
  execFileSync("git", ["check-ignore", "-q", ".env"], { cwd: dir }); // throws if not ignored
  await client.close();
});

test("updates existing keys in place and keeps them when left empty", async () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, ".env"), "# config\nA=1\nexport TOKEN=old\nB=2\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".env\n");
  let answers = { TOKEN: "new-token" };
  const { client, seen } = await connect(dir, { answer: () => ({ action: "accept", content: answers }) });
  const call = () => client.callTool({ name: "request_input", arguments: { fields: [{ key: "TOKEN" }] } });

  await call();
  assert.equal(fs.readFileSync(path.join(dir, ".env"), "utf8"), "# config\nA=1\nexport TOKEN=new-token\nB=2\n");
  assert.equal(seen[0].requestedSchema.required, undefined, "existing key should be optional");

  answers = { TOKEN: "" };
  const out = resultText(await call());
  assert.match(out, /TOKEN: kept existing value/);
  assert.match(fs.readFileSync(path.join(dir, ".env"), "utf8"), /TOKEN=new-token/);
  assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), ".env\n", "gitignore untouched");
  await client.close();
});

test("decline writes nothing", async () => {
  const dir = tmpProject();
  const { client } = await connect(dir, { answer: () => ({ action: "decline" }) });
  const out = resultText(await client.callTool({ name: "request_input", arguments: { fields: [{ key: "X" }] } }));
  assert.match(out, /declined/);
  assert.ok(!fs.existsSync(path.join(dir, ".env")));
  await client.close();
});

test("rejects bad keys and paths are relative to project", async () => {
  const dir = tmpProject({ git: false });
  const { client } = await connect(dir, { answer: () => ({ action: "accept", content: { K: "v" } }) });
  const bad = await client.callTool({ name: "request_input", arguments: { fields: [{ key: "BAD KEY; rm" }] } });
  assert.ok(bad.isError);
  await client.callTool({ name: "request_input", arguments: { env_file: "apps/web/.env.local", fields: [{ key: "K" }] } });
  assert.equal(fs.readFileSync(path.join(dir, "apps/web/.env.local"), "utf8"), "K=v\n");
  await client.close();
});

test("without elicitation support it refuses and says not to ask in chat", async () => {
  const { client } = await connect(tmpProject(), { elicitation: false });
  const res = await client.callTool({ name: "request_input", arguments: { fields: [{ key: "API_KEY" }] } });
  assert.ok(res.isError);
  assert.match(resultText(res), /Do NOT ask the user to paste/);
  await client.close();
});

test("confirm_step reports done and note", async () => {
  const { client, seen } = await connect(tmpProject(), {
    answer: () => ({ action: "accept", content: { done: true, note: "used the EU region" } }),
  });
  const out = resultText(
    await client.callTool({ name: "confirm_step", arguments: { title: "Enable the Places API", url: "https://console.cloud.google.com/apis/library" } }),
  );
  assert.match(seen[0].message, /Enable the Places API/);
  assert.match(out, /confirmed.*used the EU region/s);
  await client.close();
});

test("quoteEnvValue round-trips awkward values through bash", () => {
  for (const v of ["plain", "a b", "it's", 'q"uote', "$HOME", "`x`", "back\\slash", "multi\nline", "=eq=", "#hash", "it's\nmulti \"$x\""]) {
    const got = execFileSync("bash", ["-c", `V=${quoteEnvValue(v)}; printf %s "$V"`]).toString();
    assert.equal(got, v, `value ${JSON.stringify(v)}`);
  }
});

test("replacing a multi-line value removes its old continuation lines", async () => {
  const { upsertEnv } = await import("../plugins/human-input/server/index.mjs");
  const dir = tmpProject({ git: false });
  const env = path.join(dir, ".env");
  fs.writeFileSync(env, "A=1\nPEM='-----BEGIN\nabc\n-----END'\nB=2\n");
  upsertEnv(env, [["PEM", "short"]]);
  assert.equal(fs.readFileSync(env, "utf8"), "A=1\nPEM=short\nB=2\n");
});
