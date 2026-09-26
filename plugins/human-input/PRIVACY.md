# Privacy

human-input runs entirely on your machine, inside Claude Code. It has no
server, no analytics and no telemetry, and it makes no network requests.

- **What it stores:** the values you type into its forms, in
  `~/.claude/human-input/` (one file per value, readable only by you), plus
  any env file you or Claude choose to have them written to.
- **What Claude sees:** the names of stored values, and the values of fields
  marked non-secret. Secret values are never returned to Claude. If one shows
  up in Bash, Read or Grep output, it's replaced with `[redacted:NAME]`.
- **What leaves your machine:** nothing is sent anywhere by the plugin. A
  secret goes to a third-party service only when a command you approve sends
  it there (for example `gh secret set`).
- **Deleting data:** ask Claude to forget a value (`forget_secrets`), or
  delete `~/.claude/human-input/`.

Questions: https://github.com/manalkaff/human-input/issues
