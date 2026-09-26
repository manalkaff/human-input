# human-input

A Claude Code plugin that lets Claude ask you for API keys and other secrets
through a form in the same session. It then saves them to an env file or
passes them to a CLI, without the value ever entering the conversation.

```
/plugin marketplace add manalkaff/human-input
/plugin install human-input@human-input
```

Full documentation: [plugins/human-input/README.md](plugins/human-input/README.md)
· Privacy: [PRIVACY.md](plugins/human-input/PRIVACY.md)
· Support: [GitHub issues](https://github.com/manalkaff/human-input/issues)

## Develop

```
npm install   # dev only: the official MCP SDK, used as the test client
npm test
claude plugin validate .
```
