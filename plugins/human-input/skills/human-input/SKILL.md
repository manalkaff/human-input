---
name: human-input
description: Collect API keys, tokens, passwords or other values only the human has — and walk them through manual dashboard steps — without the secret entering the conversation. Use whenever a task is blocked on a credential or on something the human must click through (creating an API key, enabling an API, configuring a webhook, setting up CI secrets). Never ask the user to paste a secret into chat.
---

# Human input

When work is blocked on something only the human can provide, use the
`human-input` MCP tools instead of asking in chat:

- `request_input` shows an input form in this session. Values are written
  straight to an env file (default `.env`, created with mode 600 and added
  to `.gitignore`). **Secret fields are never returned to you**; you only
  learn that they were saved and their length. Fields with `secret: false`
  are returned.
- `confirm_step` asks the human to do a manual step (click through a
  dashboard, enable an API, approve an OAuth app) and waits for "done".

## How to run it like a wizard

1. **Scope before asking.** Read `.env.example`, `.env*`, README, framework
   config and `.github/workflows/*` (every `secrets.*` is a value you need).
   Work out every value and every manual step, in dependency order.
2. **One focused form per page.** Group values the human copies from the
   same page into one `request_input` call. Give:
   - `url`: the exact page (e.g. the provider's API-keys page). It opens in
     their browser on local sessions and is shown as a link otherwise.
   - `steps`: concrete clicks, e.g. "Developers → API keys → Reveal test
     key → copy". If you don't know the current UI, say so or check the
     docs — don't invent buttons.
   - `fields`: env var names that match what the code reads, a label, and a
     hint such as "starts with `sk_test_`". Mark only truly public values
     (publishable keys, project IDs, regions) `secret: false`.
3. **Pure actions** (no value to capture) go through `confirm_step`.
4. If the user declines or cancels, stop and ask how they want to proceed.

## Using the saved values — without leaking them

The values are on disk, not in your context. Keep it that way:

- Load them in the same command that needs them, without printing:
  `set -a; . ./.env; set +a; npm run dev` — or rely on the app's own dotenv
  loading.
- Never `cat`, `echo`, `grep`, `head`, `env`, `printenv` or otherwise print
  the file or the variables. Never pass a secret as a visible CLI argument.
- To check a key exists without revealing it:
  `grep -c '^STRIPE_SECRET_KEY=' .env`.
- To verify a key works, call the API and print only the status code.

## If no form can be shown

If the tool reports that this client doesn't support elicitation, don't
fall back to asking for the secret in chat. Tell the user which variables
to add to which file (or, in Claude Code on the web, to add them as
environment secrets in the environment's settings) and wait until they
confirm.
