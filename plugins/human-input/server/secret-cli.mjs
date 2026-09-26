// Print a value stored by the human-input plugin, for use inside another
// command:   gh secret set KEY --body "$(human-input-secret KEY)"
// Output is redacted from Claude's view by the plugin's PostToolUse hook.

import { findProject, get, list, NAME_RE } from "./store.mjs";

const name = process.argv[2];
if (!name || !NAME_RE.test(name) || process.argv.length > 3) {
  process.stderr.write('usage: "$(human-input-secret NAME)"  (inside another command)\n');
  process.exit(2);
}
const project = findProject(name);
const value = project && get(name, project);
if (value === undefined) {
  const known = list(process.env.CLAUDE_PROJECT_DIR || process.cwd()).map((m) => m.name);
  process.stderr.write(
    `human-input-secret: nothing stored as ${name}.${known.length ? ` Stored: ${known.join(", ")}.` : ""} Ask the human with the request_input tool first.\n`,
  );
  process.exit(1);
}
process.stdout.write(value);
