# human-input

A Claude Code plugin that lets Claude ask you for API keys and other secrets in
the same session, through a form, without the value ever entering the
transcript.

When Claude hits a step that needs a key, it no longer asks you to paste it
into the chat (which puts it in the transcript and gets you told to rotate it).
It also doesn't send you off to edit `.env` or run a wizard script in another
terminal. It calls a tool, and this form appears in your session:

```
Stripe test keys

Open: https://dashboard.stripe.com/test/apikeys

1. Copy the Publishable key (starts pk_test_).
2. Click "Reveal test key" on the Secret key row and copy it.

(Opened in your browser.) Values are written to .env. Secret values are not sent to Claude.

  Publishable key  ▏pk_test_…
  Secret key       ▏sk_test_…      secret: saved to disk, never shown to Claude
```

You paste the key and press Enter. It goes straight into `.env`, and Claude
only sees:

```
Wrote to .env:
- STRIPE_PUBLISHABLE_KEY: saved = "pk_test_…"
- STRIPE_SECRET_KEY: saved (107 chars, hidden)
```

It works like `AskUserQuestion` combined with Matt Pocock's
[wizard](https://github.com/mattpocock/skills/tree/main/skills/engineering/wizard):
it shows the page URL and exact steps, and captures and saves the values, all
without leaving the session.

## Install

```
/plugin marketplace add manalkaff/human-input
/plugin install human-input@human-input
```

Then restart the session (or run `/reload-plugins`). You need Node.js 18 or
later. The plugin has no npm dependencies.

## What you get

| Piece | What it does |
| --- | --- |
| `request_input` tool | Shows a form with one or more fields. Values are written to an env file (`.env` by default, or any path such as `apps/web/.env.local`). **Secret fields are never returned to Claude.** Fields marked `secret: false` (publishable keys, project IDs) are returned so Claude can use them. |
| `confirm_step` tool | "Go do X on this page, tell me when it's done." Use it for manual steps with no value to capture, such as enabling an API, adding a webhook or approving an OAuth app. |
| `human-input` skill | Tells Claude to use the tools instead of asking in chat, to scope everything first (`.env.example`, CI `secrets.*`), to group one form per page, and to use the saved values without printing them (`set -a; . ./.env; set +a; cmd`). |

Other details:

- The env file is written atomically with mode `600`, and existing keys are
  updated in place. Comments, ordering and `export` prefixes are kept.
- If the file isn't already git-ignored, it's added to `.gitignore`.
- If a key is already set, leaving its field empty keeps the old value.
- In local sessions, the URL opens in your browser automatically. In Claude
  Code on the web it's shown as a link instead.

## How it works (and its limits)

The plugin bundles a small, dependency-free MCP server
(`plugins/human-input/server/index.mjs`). It uses **MCP elicitation**: the
server asks Claude Code to show you a form, and your answer goes back to the
server, not to the model. The server writes the value to disk and returns only
a summary as the tool result. That tool result is the only part Claude sees.

Things to know:

- **Elicitation support.** Claude Code 2.1.283 advertises form-mode
  elicitation to local stdio servers (verified). If a client doesn't support
  it, the tool refuses. It tells Claude to have you add the value yourself,
  and not to ask for it in chat.
- **Masking.** Claude Code's form may show what you type on screen as you
  type it. It isn't sent to Claude, but don't share your screen.
- **The MCP spec** says form-mode elicitation shouldn't be used for sensitive
  data, and recommends URL mode (a web page the server hosts). This plugin
  still uses form mode on purpose: the server runs locally, on your machine or
  your session container, and the whole point is staying in the same window.
  A URL-mode fallback can be added once Claude Code advertises it.
- **Cloud sessions are ephemeral.** A `.env` written in a Claude Code on the
  web session disappears with the container. For keys you need in every
  session, add them as environment secrets in the environment settings.
- **Hooks.** If you've set up `Elicitation`/`ElicitationResult` hooks
  yourself, they receive the submitted values.

## Develop

```
npm install   # dev only: the official MCP SDK, used as the test client
npm test      # end-to-end tests: SDK client plays Claude Code + the human
claude plugin validate .
```

Try it locally without installing:

```
claude --plugin-dir ./plugins/human-input
```
