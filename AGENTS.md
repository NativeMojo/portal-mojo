# Portal-MOJO Agent Guide

This file is loaded automatically by ChatGPT and Codex. Read `CLAUDE.md` and
`PLAN.md` in full at the start of every task; they remain the detailed shared
project handbook.

Use the Maestro board configured in `.claude/maestro.json` and select the
smallest matching generated skill under `.agents/skills/`: `$maestro-task`,
`$maestro-scope`, `$maestro-build`, `$maestro-auto`, `$maestro-vibe`,
`$maestro-release-note`, or `$sites-verify`. If Maestro is unavailable, say so
explicitly instead of silently changing workflows.

Follow the isolated-worktree, explicit-pathspec commit, cleanup, and no-push
requirements in `CLAUDE.md`. For Codex-authored commits use
`Co-Authored-By: OpenAI Codex <noreply@openai.com>`.

## Skill Synchronization

The upstream-managed dev skill pack lives under `.claude/skills/`. ChatGPT and
Codex discover generated counterparts under `.agents/skills/`; never hand-edit
those generated files. After `get_dev_skills()` refreshes the upstream pack,
run:

```bash
scripts/sync_maestro_skills.py
scripts/sync_maestro_skills.py --check
```
