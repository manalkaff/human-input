# human-input

A Claude Code plugin that lets Claude ask you for API keys and other secrets in
the same session, through a form, and then use them wherever they're needed
(an env file, a CLI, another MCP tool) without the value ever entering the
conversation.

When Claude hits a step that needs a key, it no longer asks you to paste it
into the chat (which puts it in the transcript and gets you told to rotate it).
It also doesn't send you off to edit files or run a wizard script in another
terminal. It calls a tool, and this form appears in your session:

```
Stripe test keys

Open: https://dashboard.stripe.com/test/apikeys

1. Copy the Publishable key (starts pk_test_).
2. Click "Reveal test key" on the Secret key row and copy it.

(Opened in your browser.) Saved privately and written to .env.local. Secret values are not sent to Claude.

  Publishable key  ▏pk_test_…
  Secret key       ▏sk_test_…      secret: never shown to Claude
```

You paste the key and press Enter. Claude only sees:

```
Saved:
- STRIPE_PUBLISHABLE_KEY = "pk_test_…" → {{secret:STRIPE_PUBLISHABLE_KEY}}
- STRIPE_SECRET_KEY: saved (107 chars, hidden) → {{secret:STRIPE_SECRET_KEY}}
Also written to .env.local (STRIPE_PUBLISHABLE_KEY, STRIPE_SECRET_KEY).
```

It works like `AskUserQuestion` combined with Matt Pocock's
[wizard](https://github.com/mattpocock/skills/tree/main/skills/engineering/wizard):
it shows the page URL and exact steps, and captures the values, all without
leaving the session.

## Claude decides where the value goes

Every value goes into a private store outside the repo. From there, Claude
sends it wherever the task needs it:

| Destination | What Claude does |
| --- | --- |
| A dotenv file | `request_input` with `save_to: ".env.local"` (any path; created with mode 600 and git-ignored) |
| A CLI | `gh secret set STRIPE_KEY --body {{secret:STRIPE_KEY}}`, `modal secret create stripe STRIPE_KEY={{secret:STRIPE_KEY}}`, … |
| Another MCP tool | `mcp__dokploy__…({ "env": "STRIPE_KEY={{secret:STRIPE_KEY}}" })` |
| Any other file | `printf 'token = "%s"\n' {{secret:TOKEN}} >> config.toml` |

The plugin's hooks make the placeholders work:

- **Before a tool runs** (`PreToolUse`), `{{secret:NAME}}` is replaced with the
  real value. In Bash it becomes `"$(cat '<store>/NAME')"`, so the command
  reads the value when it runs and the value is never written into the
  command itself. In MCP tool arguments the literal value is swapped in.
  An unknown name blocks the call and tells Claude to ask for it first.
- **After any tool runs** (`PostToolUse`), stored secret values that appear
  in the output (a `cat .env`, an API echoing your key back) are replaced
  with their placeholder before Claude sees them.

## Install

```
/plugin marketplace add manalkaff/human-input
/plugin install human-input@human-input
```

Then restart the session (or run `/reload-plugins`). You need Node.js 18 or
later. The plugin has no npm dependencies.

## Tools

| Tool | What it does |
| --- | --- |
| `request_input` | Shows a form with one or more fields, plus a `url` and `steps`. Values are stored privately. Secret values are never returned; non-secret ones (`secret: false`) are. `save_to` also writes them into a dotenv file. |
| `confirm_step` | "Go do X on this page, tell me when it's done", for steps with no value to capture. |
| `list_secrets` | Names, lengths and where each value was saved. Never the secret values themselves. |
| `forget_secrets` | Deletes values from the store, e.g. after rotating a key. |

The bundled `human-input` skill teaches Claude when to use these and how:
scope everything first, use one form per page, pick the right destination,
and never print values.

## Where things are stored

`$CLAUDE_PLUGIN_DATA/projects/<hash of project path>/`, which is usually
`~/.claude/plugins/data/human-input-human-input/…`. There is one file per
value (mode 600) and a `meta.json` holding names only.

## Limits

- **Elicitation support.** Claude Code 2.1.283 advertises form-mode
  elicitation to local stdio servers (verified). If a client doesn't support
  it, the tool refuses. It tells Claude to have you put the value in place
  yourself, and not to ask for it in chat.
- **Masking.** Claude Code's form may show what you type on screen as you
  type it. It isn't sent to Claude.
- **Swapping values into MCP tool arguments.** Claude Code saves the hook's
  output in the local session log. For MCP tools that output contains the
  value, because the tool needs it literally. Claude still never sees it.
  Bash placeholders and `save_to` don't have this issue.
- **Bash output is redacted, but the side effects are real.** If Claude
  writes a secret into a file, that file holds the real value.
- **Short values aren't redacted.** Values under 6 characters are skipped, to
  avoid mangling ordinary output. So are `secret: false` values.
- **The MCP spec** says form-mode elicitation shouldn't be used for sensitive
  data, and recommends URL mode (a web page the server hosts). This plugin
  still uses form mode on purpose: the server runs locally, and the whole
  point is staying in the same window.
- **Cloud sessions are ephemeral.** The store and any files written in a
  Claude Code on the web session disappear with the container. For keys you
  need in every session, add them as environment secrets in the environment
  settings.
- **Hooks you add yourself.** If you've set up `Elicitation`/`ElicitationResult`
  hooks, they receive the submitted values.

## Develop

```
npm install   # dev only: the official MCP SDK, used as the test client
npm test      # end-to-end server tests + hook tests (runs real bash)
claude plugin validate .
```

Try it locally without installing:

```
claude --plugin-dir ./plugins/human-input
```
