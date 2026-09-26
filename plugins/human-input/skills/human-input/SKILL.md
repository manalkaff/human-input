---
name: human-input
description: Collect API keys, tokens, passwords or other values only the human has — and walk them through manual dashboard steps — without the secret entering the conversation, then deliver the value wherever the task needs it (an env file, or a CLI such as gh/modal/vercel via "$(human-input-secret NAME)"). Use whenever a task is blocked on a credential or on something the human must click through. Never ask the user to paste a secret into chat.
---

# Human input

When work is blocked on something only the human can provide, use the
`human-input` MCP tools instead of asking in chat:

- `request_input` shows an input form in this session. Values go into a
  private store outside the repo. **Secret values are never returned to
  you**; you use them through `"$(human-input-secret NAME)"`. Fields with
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
| A CLI (`gh secret set`, `modal secret create`, `vercel env add`, `fly secrets set`, `wrangler secret put`…) | Use `"$(human-input-secret NAME)"` inside the command: `gh secret set STRIPE_KEY --body "$(human-input-secret STRIPE_KEY)"`, `modal secret create stripe STRIPE_KEY="$(human-input-secret STRIPE_KEY)"`. |
| Any other file format | `printf 'token = "%s"\n' "$(human-input-secret TOKEN)" >> config.toml` |
| An MCP tool | Not supported: its arguments would contain the value, so you'd see it. Use the service's CLI instead, or ask the human to enter the value in that service themselves (`confirm_step`). |

`human-input-secret` is a command the plugin puts on the Bash PATH. It prints
the stored value, so only use it inside `"$(…)"` in another command. Never
run it on its own. If a stored secret does show up in Bash, Read or Grep
output, the plugin replaces it with `[redacted:NAME]`.

## 4. Don't leak it yourself

- Don't try to print, decode or reconstruct secret values. Output is
  redacted, but don't rely on that.
- Don't read env files that hold secrets. Let the app load them itself, or
  use `human-input-secret`.

## If no form can be shown

If the tool reports that this client doesn't support elicitation, don't fall
back to asking for the secret in chat. Tell the human which values to put
where (or, in Claude Code on the web, to add them as environment secrets in
the environment's settings) and wait until they confirm.
