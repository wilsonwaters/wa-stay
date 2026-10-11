# Agents

Instructions for AI coding agents working on WA Stay live in [CLAUDE.md](CLAUDE.md): the
project, its commands, its architecture, and the checks every change must pass. Read it first;
this file only points into it, so there is one source of truth.

- **Adding an accommodation provider:** follow the checklist in
  [CLAUDE.md, "Adding a provider"](CLAUDE.md#adding-a-provider). It starts with
  `npm run provider:new -- <id>`, and [the provider guide](docs/providers/adding-a-provider.md)
  is the reference. `.claude/commands/add-provider.md` walks through the same steps.
- **Before you commit:** the pre-commit checklist in [CLAUDE.md](CLAUDE.md#pre-commit-checklist).
- **Never** place a real hold, booking or payment on any provider, in a test or otherwise.
