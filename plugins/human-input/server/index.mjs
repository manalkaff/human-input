#!/usr/bin/env node
// human-input: an MCP server that asks the human for values (API keys, tokens,
// IDs) through MCP elicitation, writes them straight to disk, and tells the
// model only *that* they were saved — never the secret itself.
//
// Zero dependencies on purpose: plugins are installed by cloning, with no
// `npm install` step, so this speaks newline-delimited JSON-RPC over stdio
// directly.

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const SERVER_INFO = { name: "human-input", version: "0.1.0" };
const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ── JSON-RPC plumbing ────────────────────────────────────────────────────

let clientCapabilities = {};
let nextRequestId = 1;
const pending = new Map(); // id -> { resolve, reject }

function send(msg) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
}

function request(method, params) {
  const id = `hi-${nextRequestId++}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });
}

function log(...args) {
  // stderr only; stdout is the protocol channel. Never log values.
  process.stderr.write(`[human-input] ${args.join(" ")}\n`);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function resolveTarget(file) {
  const target = file && file.trim() ? file.trim() : ".env";
  return path.resolve(projectDir(), target);
}

function isRemote() {
  return Boolean(process.env.CLAUDE_CODE_REMOTE);
}

function openUrl(url) {
  if (isRemote() || process.env.HUMAN_INPUT_NO_BROWSER) return false;
  const candidates =
    process.platform === "darwin"
      ? [["open", [url]]]
      : process.platform === "win32"
        ? [["cmd", ["/c", "start", "", url]]]
        : [["wslview", [url]], ["xdg-open", [url]]];
  for (const [cmd, args] of candidates) {
    try {
      execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    } catch {
      if (process.platform !== "win32") continue;
    }
    execFile(cmd, args, { stdio: "ignore" }, () => {});
    return true;
  }
  return false;
}

// Quote a value so both `set -a; . .env` and dotenv-style parsers read it back
// unchanged. Newlines stay literal (multi-line PEM keys work in both).
export function quoteEnvValue(value) {
  if (/^[A-Za-z0-9_\-.:/+=@,~%^]*$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  const escaped = value.replace(/[\\"$`]/g, (c) => `\\${c}`);
  return `"${escaped}"`;
}

// How many lines the entry starting at lines[i] spans (quoted values may
// continue over several lines).
function entrySpan(lines, i) {
  const m = lines[i].match(/=\s*(['"])(.*)$/);
  if (!m) return 1;
  const [, q, rest] = m;
  const closes = (str) => (q === "'" ? str.includes("'") : /(^|[^\\])"/.test(str));
  if (closes(rest)) return 1;
  for (let j = i + 1; j < lines.length; j++) if (closes(lines[j])) return j - i + 1;
  return 1; // unterminated: only touch the first line
}

// Insert or replace KEY=value entries, preserving order and every other line.
export function upsertEnv(file, entries) {
  let lines = [];
  if (fs.existsSync(file)) {
    lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
  }
  for (const [key, value] of entries) {
    const line = `${key}=${quoteEnvValue(value)}`;
    const re = new RegExp(`^\\s*(export\\s+)?${key}\\s*=`);
    const out = [];
    let placed = false;
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) {
        out.push(lines[i]);
        continue;
      }
      // Replace the first occurrence in place; drop later duplicates.
      if (!placed) out.push(/^\s*export\s+/.test(lines[i]) ? `export ${line}` : line);
      placed = true;
      i += entrySpan(lines, i) - 1;
    }
    if (!placed) out.push(line);
    lines = out;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.human-input-${process.pid}.tmp`;
  fs.writeFileSync(tmp, lines.join("\n") + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

export function existingKeys(file) {
  if (!fs.existsSync(file)) return new Set();
  const keys = new Set();
  for (const l of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

// Make sure a file we just put secrets in can't be committed by accident.
// Returns a short note for the tool result, or "".
function ensureGitignored(file) {
  const dir = path.dirname(file);
  let root;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return ""; // not a git repo
  }
  try {
    execFileSync("git", ["check-ignore", "-q", file], { cwd: root, stdio: "ignore" });
    return ""; // already ignored
  } catch {}
  const rel = path.relative(root, file).split(path.sep).join("/");
  const gi = path.join(root, ".gitignore");
  const prefix = fs.existsSync(gi) && !fs.readFileSync(gi, "utf8").endsWith("\n") ? "\n" : "";
  fs.appendFileSync(gi, `${prefix}/${rel}\n`);
  return ` Added /${rel} to .gitignore so it can't be committed.`;
}

function buildMessage({ title, why, url, steps, note }) {
  const parts = [];
  if (title) parts.push(title);
  if (why) parts.push(why);
  if (url) parts.push(`Open: ${url}`);
  if (steps?.length) parts.push(steps.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  if (note) parts.push(note);
  return parts.join("\n\n");
}

function text(t, isError = false) {
  return { content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) };
}

function supportsFormElicitation() {
  const e = clientCapabilities.elicitation;
  if (!e) return false;
  // Per spec, an empty object means form mode.
  return Object.keys(e).length === 0 || Boolean(e.form);
}

function noElicitationFallback(keys, file) {
  const rel = path.relative(projectDir(), file) || file;
  return text(
    [
      "This Claude Code client did not advertise MCP elicitation, so no input form could be shown.",
      "Do NOT ask the user to paste the value into the chat.",
      `Instead, tell the user to add ${keys.join(", ")} to ${rel} themselves (or, in a Claude Code on the web`,
      "session, as an environment secret in the environment settings) and let you know when it's done.",
    ].join(" "),
    true,
  );
}

// ── Tools ────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "request_input",
    title: "Ask the human for secrets / values",
    description: [
      "Show the human an input form in this session and save their answers directly to an env file.",
      "Use this whenever you need an API key, token, password, connection string or any value only the human has.",
      "NEVER ask the user to paste secrets into the chat — use this tool instead.",
      "Secret values are written to disk and are NEVER returned to you; you only learn that they were saved.",
      "Non-secret fields (secret: false) are returned so you can use them.",
      "Wizard-style: pass the `url` where the value can be found and concrete `steps` (what to click/copy); the URL is opened in the user's browser when running locally and shown as a link otherwise.",
      "Group values that come from the same page into one call. To use saved values in commands, load them without printing, e.g. `set -a; . ./.env; set +a; <command>` — never cat/echo/grep the file.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short heading, e.g. 'Stripe test API keys'." },
        why: { type: "string", description: "One sentence on what the values are needed for." },
        url: { type: "string", description: "Page where the human gets the value(s), e.g. the provider's API key dashboard." },
        steps: {
          type: "array",
          items: { type: "string" },
          description: "Exact steps a stranger could follow on that page, e.g. 'Click Reveal test key, then copy it'. Don't invent UI you are unsure of.",
        },
        fields: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Env var name to write, e.g. STRIPE_SECRET_KEY." },
              label: { type: "string", description: "Field label shown to the human." },
              description: { type: "string", description: "Hint, e.g. 'starts with sk_test_'." },
              secret: { type: "boolean", default: true, description: "true (default): never returned to you. false: value is returned in the tool result." },
              required: { type: "boolean", default: true },
            },
            required: ["key"],
          },
        },
        env_file: { type: "string", default: ".env", description: "File to write, relative to the project root. Defaults to .env." },
        open_browser: { type: "boolean", default: true, description: "Open `url` in the user's browser (local sessions only)." },
      },
      required: ["fields"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "confirm_step",
    title: "Walk the human through a manual step",
    description: [
      "Ask the human to do something only they can do (click through a dashboard, enable an API, install an app, approve an OAuth grant) and wait until they confirm it's done.",
      "Wizard-style: pass the `url` to open and concrete `steps`. Returns whether they completed it, plus an optional note they typed.",
      "Do not use this to collect secrets — use request_input for that.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        why: { type: "string" },
        url: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        open_browser: { type: "boolean", default: true },
      },
      required: ["title"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

async function requestInput(args) {
  const fields = Array.isArray(args.fields) ? args.fields : [];
  if (!fields.length) return text("`fields` must contain at least one field.", true);
  const seen = new Set();
  for (const f of fields) {
    if (!f || typeof f.key !== "string" || !KEY_RE.test(f.key)) {
      return text(`Invalid field key ${JSON.stringify(f?.key)}: use an env var name like API_KEY.`, true);
    }
    if (seen.has(f.key)) return text(`Duplicate field key ${f.key}.`, true);
    seen.add(f.key);
  }

  const file = resolveTarget(args.env_file);
  const rel = path.relative(projectDir(), file) || file;
  const keys = fields.map((f) => f.key);
  if (!supportsFormElicitation()) return noElicitationFallback(keys, file);

  const already = existingKeys(file);
  const opened = args.url && args.open_browser !== false ? openUrl(args.url) : false;

  const properties = {};
  const required = [];
  for (const f of fields) {
    const secret = f.secret !== false;
    const hints = [];
    if (f.description) hints.push(f.description);
    if (secret) hints.push("secret: saved to disk, never shown to Claude");
    if (already.has(f.key)) hints.push(`already set in ${rel}; leave empty to keep it`);
    properties[f.key] = {
      type: "string",
      title: f.label || f.key,
      description: hints.join(" · "),
    };
    if (f.required !== false && !already.has(f.key)) required.push(f.key);
  }

  const note = [
    opened ? "(Opened in your browser.)" : "",
    `Values are written to ${rel}. Secret values are not sent to Claude.`,
  ]
    .filter(Boolean)
    .join(" ");

  let res;
  try {
    res = await request("elicitation/create", {
      mode: "form",
      message: buildMessage({ ...args, note }),
      requestedSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
    });
  } catch (err) {
    log("elicitation failed:", err?.message ?? String(err));
    return noElicitationFallback(keys, file);
  }

  if (res?.action !== "accept") {
    return text(
      `The user ${res?.action === "decline" ? "declined" : "cancelled"} the input form; nothing was saved. Ask them how they'd like to proceed rather than retrying immediately.`,
    );
  }

  const content = res.content ?? {};
  const toWrite = [];
  const report = [];
  const missing = [];
  for (const f of fields) {
    const secret = f.secret !== false;
    let v = content[f.key];
    v = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
    if (!v) {
      if (already.has(f.key)) report.push(`${f.key}: kept existing value`);
      else if (f.required !== false) missing.push(f.key);
      else report.push(`${f.key}: left empty (optional)`);
      continue;
    }
    toWrite.push([f.key, v]);
    report.push(secret ? `${f.key}: saved (${v.length} chars, hidden)` : `${f.key}: saved = ${JSON.stringify(v)}`);
  }

  if (toWrite.length) upsertEnv(file, toWrite);
  const gi = toWrite.length ? ensureGitignored(file) : "";
  const lines = [`Wrote to ${rel}:`, ...report.map((r) => `- ${r}`)];
  if (missing.length) lines.push(`Missing required value(s): ${missing.join(", ")} — ask again if still needed.`);
  if (gi) lines.push(gi.trim());
  lines.push(
    `To use them, load the file without printing it, e.g. \`set -a; . ${JSON.stringify(rel)}; set +a; <command>\`. Never cat, echo or grep the file.`,
  );
  return text(lines.join("\n"));
}

async function confirmStep(args) {
  if (!supportsFormElicitation()) {
    return text(
      "This client did not advertise MCP elicitation. Ask the user to do the step with a normal message (include the URL and steps) and wait for their reply.",
      true,
    );
  }
  const opened = args.url && args.open_browser !== false ? openUrl(args.url) : false;
  let res;
  try {
    res = await request("elicitation/create", {
      mode: "form",
      message: buildMessage({ ...args, note: opened ? "(Opened in your browser.)" : "" }),
      requestedSchema: {
        type: "object",
        properties: {
          done: { type: "boolean", title: "Done?", description: "Tick when you've finished this step.", default: true },
          note: { type: "string", title: "Anything Claude should know? (optional, visible to Claude)" },
        },
        required: ["done"],
      },
    });
  } catch (err) {
    log("elicitation failed:", err?.message ?? String(err));
    return text("Could not show the form. Ask the user in a normal message instead.", true);
  }
  if (res?.action !== "accept") return text(`The user ${res?.action ?? "cancelled"} this step.`);
  const done = res.content?.done !== false;
  const note = typeof res.content?.note === "string" && res.content.note.trim() ? ` Note from user: ${res.content.note.trim()}` : "";
  return text(`${done ? "User confirmed the step is done." : "User has NOT completed the step."}${note}`);
}

const HANDLERS = { request_input: requestInput, confirm_step: confirmStep };

// ── Dispatcher ───────────────────────────────────────────────────────────

async function handle(msg) {
  // Response to one of our requests (elicitation/create).
  if (msg.id !== undefined && !msg.method) {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message || "elicitation error"));
    else p.resolve(msg.result);
    return;
  }

  const { id, method, params } = msg;
  if (id === undefined) return; // notifications: nothing to do

  switch (method) {
    case "initialize": {
      clientCapabilities = params?.capabilities ?? {};
      const v = SUPPORTED_PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED_PROTOCOLS[1];
      return send({
        id,
        result: {
          protocolVersion: v,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            "When you need a secret or any value only the human has, call request_input instead of asking them to paste it in chat. Use confirm_step for manual dashboard steps.",
        },
      });
    }
    case "ping":
      return send({ id, result: {} });
    case "tools/list":
      return send({ id, result: { tools: TOOLS } });
    case "tools/call": {
      const fn = HANDLERS[params?.name];
      if (!fn) return send({ id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
      try {
        return send({ id, result: await fn(params.arguments ?? {}) });
      } catch (err) {
        log("tool error:", err?.message ?? String(err));
        return send({ id, result: text(`human-input failed: ${err?.message ?? err}`, true) });
      }
    }
    default:
      return send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

function isMain() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ id: null, error: { code: -32700, message: "Parse error" } });
    }
    handle(msg).catch((err) => log("dispatch error:", err?.message ?? String(err)));
  });
  rl.on("close", () => process.exit(0));
}
