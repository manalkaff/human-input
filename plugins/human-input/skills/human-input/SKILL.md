---
name: human-input
description: Collect API keys, tokens, passwords or other values only the human has — and walk them through manual dashboard steps — without the secret entering the conversation, then deliver the value wherever the task needs it (an env file, a CLI such as gh/modal/vercel, or another MCP tool) via {{secret:NAME}} placeholders. Use whenever a task is blocked on a credential or on something the human must click through. Never ask the user to paste a secret into chat.
---

# Human input

When work is blocked on something only the human can provide, use the
`human-input` MCP tools instead of asking in chat:

- `request_input` shows an input form in this session. Values go into a
  private store outside the repo. **Secret values are never returned to
  you**; you get a `{{secret:NAME}}` placeholder instead. Fields with
  `secret: false` (publishable keys, project IDs, regions) are also returned
  in plain text.
- `confirm_step` asks the human to do a manual step (enable an API, add a
  webhook, approve an OAuth app) and waits for "done".
- `list_secrets` shows what's already stored. Check it before asking again.
- `forget_secrets` deletes stored values, e.g. after a key was rotated.

## 1. Scope before asking

Read `.env.example`, `.env*`, the README, framework config, deploy config and
`.github/workflows/*` (every `secrets.*` is a value you need). Work out every
value, every manual step, and **where each value has to end up**, in
dependency order.

## 2. Ask like a wizard

Use one focused form per page. Group the values the human copies from the
same page into one `request_input` call, and give it:

- `url`: the exact page (e.g. the provider's API-keys page). It opens in the
  human's browser in local sessions and is shown as a link otherwise.
- `steps`: concrete clicks, e.g. "Developers → API keys → Reveal test key →
  copy". If you don't know the current UI, say so or check the docs. Don't
  invent buttons.
- `fields`: names that match what the code or platform expects, a label, and
  a hint such as "starts with `sk_test_`".

Use `confirm_step` for pure actions with no value to capture. If the human
declines or cancels, stop and ask how they want to proceed.

## 3. Deliver the value — you choose where

| Destination | How |
| --- | --- |
| A dotenv file the app reads | Pass `save_to` (e.g. `.env`, `apps/web/.env.local`). It's written with mode 600 and git-ignored. |
| A CLI (`gh secret set`, `modal secret create`, `vercel env add`, `fly secrets set`, `wrangler secret put`…) | Put the placeholder in the Bash command: `gh secret set STRIPE_KEY --body {{secret:STRIPE_KEY}}`, `modal secret create stripe STRIPE_KEY={{secret:STRIPE_KEY}}`, `wrangler secret put CF_TOKEN <<< {{secret:CF_TOKEN}}`. |
| Another MCP tool (a deploy platform's "set env" tool, a DB tool, …) | Put the placeholder in the argument: `{"env": "STRIPE_KEY={{secret:STRIPE_KEY}}"}`. |
| Any other file format | Bash: `printf 'token = "%s"\n' {{secret:TOKEN}} >> config.toml` |

The plugin's hooks swap the placeholder for the real value when the tool
runs, and turn the value back into the placeholder if it shows up in the
tool's output.

Rules for Bash placeholders:

- Use them unquoted or inside double quotes. Inside single quotes or a
  quoted heredoc (`<<'EOF'`) the shell can't expand them, and the call is
  blocked with an explanation. For those, move the placeholder outside the
  single quotes: `'prefix'{{secret:X}}`.
- The command reads the value with `$(cat …)` when it runs, so the value
  isn't written into the command text.

## 4. Don't leak it yourself

- Don't try to print, decode or reconstruct secret values. Output is
  redacted, but don't rely on that.
- To check a key works, call the API and print only the status code:
  `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer {{secret:KEY}}" https://api.example.com/me`.
- Prefer placeholders over reading env files. If you must load a saved
  dotenv file, do it inside the command that needs it
  (`set -a; . ./.env; set +a; npm run dev`), never with `cat`, `echo` or
  `printenv`.

## If no form can be shown

If the tool reports that this client doesn't support elicitation, don't fall
back to asking for the secret in chat. Tell the human which values to put
where (or, in Claude Code on the web, to add them as environment secrets in
the environment's settings) and wait until they confirm.
