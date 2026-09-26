#!/usr/bin/env node
// human-input hooks.
//
//   secrets.mjs pre   PreToolUse: swap {{secret:NAME}} placeholders for real
//                     values just before a Bash command or MCP tool runs.
//   secrets.mjs post  PostToolUse: replace stored secret values that show up in
//                     any tool's output with their placeholder.
//
// For Bash the placeholder becomes $(cat '<store>/values/NAME'), so the value
// itself never passes through this hook's output (which Claude Code keeps in
// the session log). MCP tools need the literal value in their arguments, so
// for them it does pass through here — still never into the model's context.

import fs from "node:fs";
import * as store from "../server/store.mjs";
import { PLACEHOLDER_RE } from "../server/store.mjs";

const OWN_TOOLS = /^mcp__plugin_human-input_/;

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function deny(reason) {
  emit({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
}

function shq(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function placeholdersIn(value) {
  const names = new Set();
  const walk = (v) => {
    if (typeof v === "string") for (const m of v.matchAll(PLACEHOLDER_RE)) names.add(m[1]);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return names;
}

function mapStrings(v, fn) {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)]));
  return v;
}

// Replace placeholders in a shell command with command substitutions that
// read the value at run time. Tracks quoting so the result stays one word:
//   unquoted            → "$(cat 'path')"
//   "double quotes"     → $(cat 'path')
//   unquoted heredoc    → $(cat 'path')
//   'single' / quoted heredoc → can't expand there: error.
export function substituteBash(cmd, pathFor) {
  let out = "";
  let state = "none"; // none | single | double
  const heredocs = []; // pending { delim, quoted, strip }
  let i = 0;

  const placeholderAt = (idx) => {
    const m = /^\{\{secret:([A-Za-z_][A-Za-z0-9_]*)\}\}/.exec(cmd.slice(idx));
    return m && { name: m[1], len: m[0].length };
  };
  const sub = (name) => `$(cat ${shq(pathFor(name))})`;
  const quoteHint = (name) =>
    `{{secret:${name}}} is inside single quotes (or a quoted heredoc), where the shell can't expand it. Put it outside the quotes or inside double quotes, e.g. 'prefix'{{secret:${name}}} or "prefix {{secret:${name}}}".`;

  while (i < cmd.length) {
    const ph = placeholderAt(i);
    if (ph) {
      if (state === "single") return { error: quoteHint(ph.name) };
      out += state === "double" ? sub(ph.name) : `"${sub(ph.name)}"`;
      i += ph.len;
      continue;
    }
    const c = cmd[i];

    if (state === "single") {
      out += c;
      if (c === "'") state = "none";
      i++;
      continue;
    }
    if (state === "double") {
      if (c === "\\" && i + 1 < cmd.length) {
        out += c + cmd[i + 1];
        i += 2;
        continue;
      }
      out += c;
      if (c === '"') state = "none";
      i++;
      continue;
    }

    // state === "none"
    if (c === "\\" && i + 1 < cmd.length) {
      out += c + cmd[i + 1];
      i += 2;
      continue;
    }
    if (c === "'") state = "single";
    else if (c === '"') state = "double";
    else if (c === "<" && cmd[i + 1] === "<" && cmd[i + 2] !== "<") {
      const m = /^<<(-?)\s*(?:(['"])([^'"\n]+)\2|\\?([A-Za-z0-9_.-]+))/.exec(cmd.slice(i));
      if (m) {
        heredocs.push({ strip: m[1] === "-", quoted: Boolean(m[2]) || m[0].includes("\\"), delim: m[3] ?? m[4] });
        out += m[0];
        i += m[0].length;
        continue;
      }
    } else if (c === "\n" && heredocs.length) {
      out += c;
      i++;
      // Consume each pending heredoc body line by line.
      for (const h of heredocs.splice(0)) {
        while (i < cmd.length) {
          const end = cmd.indexOf("\n", i);
          const line = end === -1 ? cmd.slice(i) : cmd.slice(i, end + 1);
          const bare = line.replace(/\n$/, "");
          i += line.length;
          if ((h.strip ? bare.replace(/^\t+/, "") : bare) === h.delim) {
            out += line;
            break;
          }
          let converted = "";
          for (let k = 0; k < line.length; ) {
            const p = /^\{\{secret:([A-Za-z_][A-Za-z0-9_]*)\}\}/.exec(line.slice(k));
            if (p) {
              if (h.quoted) return { error: quoteHint(p[1]) };
              converted += sub(p[1]);
              k += p[0].length;
            } else converted += line[k++];
          }
          out += converted;
        }
      }
      continue;
    }
    out += c;
    i++;
  }
  return { command: out };
}

function pre(input) {
  const tool = input.tool_name ?? "";
  if (OWN_TOOLS.test(tool)) return;
  const toolInput = input.tool_input ?? {};
  const names = placeholdersIn(toolInput);
  if (!names.size) return;

  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  const unknown = [...names].filter((n) => !store.has(n, project));
  if (unknown.length) {
    const known = store.list(project).map((m) => m.name);
    return deny(
      `No stored value for ${unknown.join(", ")}. ${known.length ? `Stored: ${known.join(", ")}. ` : ""}Call the human-input request_input tool to ask the human for it first.`,
    );
  }

  if (tool === "Bash") {
    if (typeof toolInput.command !== "string") return;
    const r = substituteBash(toolInput.command, (n) => store.valuePath(n, project));
    if (r.error) return deny(r.error);
    return emit({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...toolInput, command: r.command } } });
  }

  // MCP tools: literal values.
  const updated = mapStrings(toolInput, (s) => s.replace(PLACEHOLDER_RE, (_, n) => store.get(n, project)));
  emit({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: updated } });
}

function post(input) {
  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  const pairs = store.redactable(project);
  if (!pairs.length || input.tool_response === undefined) return;
  let changed = false;
  const redacted = mapStrings(input.tool_response, (s) => {
    let r = s;
    for (const [name, value] of pairs) {
      if (r.includes(value)) {
        r = r.split(value).join(`{{secret:${name}}}`);
        changed = true;
      }
    }
    return r;
  });
  if (!changed) return;
  const key = (input.tool_name ?? "").startsWith("mcp__") ? "updatedMCPToolOutput" : "updatedToolOutput";
  emit({ hookSpecificOutput: { hookEventName: "PostToolUse", [key]: redacted } });
}

const mode = process.argv[2];
if (mode === "pre" || mode === "post") {
  let input;
  try {
    input = JSON.parse(readStdin() || "{}");
  } catch {
    process.exit(0);
  }
  try {
    (mode === "pre" ? pre : post)(input);
  } catch (err) {
    // Never block a tool because of a bug here; say what happened on stderr.
    process.stderr.write(`[human-input] ${mode} hook error: ${err?.message ?? err}\n`);
  }
}
