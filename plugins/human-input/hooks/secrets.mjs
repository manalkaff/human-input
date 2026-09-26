#!/usr/bin/env node
// human-input PostToolUse hook: replace stored secret values that show up in
// Bash / Read / Grep output with [redacted:NAME] before Claude sees them.
// It only rewrites tool *output*; tool input is never touched.

import fs from "node:fs";
import * as store from "../server/store.mjs";

function mapStrings(v, fn) {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)]));
  return v;
}

export function redact(response, pairs) {
  let changed = false;
  const out = mapStrings(response, (s) => {
    let r = s;
    for (const [name, value] of pairs) {
      if (r.includes(value)) {
        r = r.split(value).join(store.redactedLabel(name));
        changed = true;
      }
    }
    return r;
  });
  return changed ? out : undefined;
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return;
  }
  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  const pairs = store.redactable(project);
  if (!pairs.length || input.tool_response === undefined) return;
  const redacted = redact(input.tool_response, pairs);
  if (redacted === undefined) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: redacted } }));
}

if (process.argv[2] === "post") {
  try {
    main();
  } catch (err) {
    process.stderr.write(`[human-input] redaction hook error: ${err?.message ?? err}\n`);
  }
}
