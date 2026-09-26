// The secret store shared by the MCP server and the hooks.
//
// Values live outside the repo, one file per value (mode 600), in a directory
// per project:
//   ${CLAUDE_PLUGIN_DATA:-~/.claude/human-input}/projects/<hash>/values/NAME
//   ${CLAUDE_PLUGIN_DATA:-~/.claude/human-input}/projects/<hash>/meta.json
// meta.json holds names and bookkeeping only, never values.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const PLACEHOLDER_RE = /\{\{secret:([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

// Values shorter than this aren't redacted from tool output: too likely to
// collide with ordinary text.
const MIN_REDACT_LENGTH = 6;

export function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

export function storeDir(project = projectDir()) {
  const base = process.env.HUMAN_INPUT_STORE || process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), ".claude", "human-input");
  let real = project;
  try {
    real = fs.realpathSync(project);
  } catch {}
  const hash = crypto.createHash("sha256").update(real).digest("hex").slice(0, 16);
  return path.join(base, "projects", hash);
}

export function valuePath(name, project) {
  return path.join(storeDir(project), "values", name);
}

function metaPath(project) {
  return path.join(storeDir(project), "meta.json");
}

export function readMeta(project) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(project), "utf8"));
  } catch {
    return {};
  }
}

function writeMeta(meta, project) {
  const file = metaPath(project);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(meta, null, 2) + "\n", { mode: 0o600 });
}

export function has(name, project) {
  return fs.existsSync(valuePath(name, project));
}

export function get(name, project) {
  try {
    return fs.readFileSync(valuePath(name, project), "utf8");
  } catch {
    return undefined;
  }
}

export function set(name, value, { secret = true, savedTo } = {}, project) {
  if (!NAME_RE.test(name)) throw new Error(`invalid name ${name}`);
  const file = valuePath(name, project);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, value, { mode: 0o600 });
  fs.renameSync(tmp, file);
  const meta = readMeta(project);
  const prev = meta[name] ?? {};
  const files = new Set(prev.savedTo ?? []);
  if (savedTo) files.add(savedTo);
  meta[name] = { secret, length: value.length, savedTo: [...files], updatedAt: new Date().toISOString() };
  writeMeta(meta, project);
}

export function addSavedTo(name, savedTo, project) {
  const meta = readMeta(project);
  if (!meta[name]) return;
  meta[name].savedTo = [...new Set([...(meta[name].savedTo ?? []), savedTo])];
  writeMeta(meta, project);
}

export function remove(name, project) {
  try {
    fs.unlinkSync(valuePath(name, project));
  } catch {}
  const meta = readMeta(project);
  delete meta[name];
  writeMeta(meta, project);
}

export function list(project) {
  const meta = readMeta(project);
  return Object.entries(meta)
    .filter(([name]) => NAME_RE.test(name) && has(name, project))
    .map(([name, m]) => ({ name, ...m }));
}

// [name, value] pairs worth redacting from tool output, longest first so a
// value that contains another is replaced whole.
export function redactable(project) {
  return list(project)
    .filter((m) => m.secret !== false)
    .map((m) => [m.name, get(m.name, project)])
    .filter(([, v]) => typeof v === "string" && v.length >= MIN_REDACT_LENGTH)
    .sort((a, b) => b[1].length - a[1].length);
}
